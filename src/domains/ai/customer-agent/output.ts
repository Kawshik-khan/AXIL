/**
 * Output pipeline for the customer agent (AI fix plan FX-78; audit F16, F22, F28). Every reply passes through here
 * before it is sent, in this order:
 *   1. not a message (empty, JSON, a tool call written as text) → the runtime retries once, then hands off;
 *   2. sanitize: no HTML, Markdown emphasis or headings, links; plain hyphens in order numbers;
 *   3. phone guard: a BD mobile / bKash / Nagad number must be the shop's own or one this customer typed (F22);
 *   4. order-claim guard: "your order is placed/confirmed" needs an order number place_order returned in this chat (F28);
 *   5. price guard: every amount must come from this turn's tool results or the server's session state;
 *   6. payment-claim guard: no "payment received / verified" (cash on delivery only; no claims exist yet);
 *   7. handoff-promise guard: a promise that a person will reply is made true by a real handoff (runtime);
 *   8. length cap: 1,000 characters, cut at a sentence.
 * All deterministic: no model call.
 */
import { db } from "@/infrastructure/db";
import { customerMessages } from "./confirmation";

export type Script = "bangla" | "latin";

/** The script of the customer's latest message, decided by the server so the model doesn't have to infer it. */
export function replyScript(text: string): Script {
  const letters = text.match(/[\p{L}\p{M}]/gu) || []; // Bangla vowel signs are marks (\p{M}), not letters
  const bn = letters.filter((c) => /[ঀ-৿]/.test(c)).length;
  return letters.length && bn / letters.length >= 0.3 ? "bangla" : "latin";
}

/** A reply that is not something to send to a person. */
export function notAMessage(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^[[{]/.test(t)) {
    try {
      JSON.parse(t);
      return true;
    } catch {
      /* not JSON */
    }
  }
  return /<\/?tool_call>|"arguments"\s*:|^\s*(?:functions\.|to=functions)/i.test(t);
}

export function sanitizeOutbound(text: string): string {
  return text
    .replace(/<[^>]{1,200}>/g, "")
    .replace(/\[([^\]]{1,80})\]\([^)]{1,300}\)/g, "$1")
    .replace(/\bhttps?:\/\/\S+/gi, "[link removed]")
    .replace(/\*\*([^*\n]{1,200})\*\*|__([^_\n]{1,200})__/g, "$1$2") // chat apps show Markdown emphasis as raw symbols
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[‐‑‒–](?=\d)|(?<=\d)[‐‑‒]/g, "-") // gpt-oss writes ORD‑2026‑000001 with non-breaking hyphens
    .trim();
}

const toAsciiDigits = (s: string) => s.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)));
const normPhone = (s: string) => toAsciiDigits(s).replace(/\D/g, "").replace(/^88/, "");

function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => stringsIn(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => stringsIn(v, out));
  return out;
}

/** F22: phone / bKash / Nagad numbers must be the shop's own (tenant settings) or typed by this customer. */
export function guardPhoneNumbers(tenantId: string, conversationId: string, text: string): { text: string; removed: number } {
  const settings = db.findTenantById(tenantId)?.settings ?? {};
  const own = stringsIn(settings).map(normPhone).filter((v) => /^01\d{9}$/.test(v));
  const typed = customerMessages(tenantId, conversationId).flatMap((m) => (m.match(/(?:\+?88)?0?1[3-9][\d\s-]{8,10}|[০-৯]{11}/g) || []).map(normPhone));
  const allowed = new Set([...own, ...typed]);
  let removed = 0;
  const out = text.replace(/(?:\+?৮৮|\+?88)?[0০]?[1১][3-9৩-৯][\d০-৯\s-]{8,11}/g, (m) => {
    const n = normPhone(m);
    if (!/^01[3-9]\d{8}$/.test(n) || allowed.has(n)) return m;
    removed++;
    return "[number removed]";
  });
  return { text: out, removed };
}

const ORDER_CLAIM =
  /\border\b[^.।\n]{0,40}\b(?:is |has been |was )?(?:placed|confirmed|complete)\b|order (?:confirm|place)[^.।\n]{0,12}(?:hoye ?(?:che|geche|gese)|kora hoyeche|korechi|kora holo)|অর্ডার(?:টি|টা)?[^.।\n]{0,30}(?:নিশ্চিত|কনফার্ম|প্লেস)\s*(?:করা )?(?:হয়েছে|হলো|হল|করেছি)/i;

/** F28: claiming an order is placed needs an order number that place_order returned in this conversation. */
export function guardOrderClaim(text: string, placedOrderNumbers: readonly string[], script: Script): { text: string; blocked: boolean } {
  if (!ORDER_CLAIM.test(text)) return { text, blocked: false };
  const mentioned = (text.match(/ORD-\d{4}-\d{3,}/gi) || []).map((s) => s.toUpperCase());
  if (mentioned.some((n) => placedOrderNumbers.includes(n))) return { text, blocked: false };
  return {
    blocked: true,
    text:
      script === "bangla"
        ? "অর্ডারটি এখনও প্লেস করা হয়নি। আপনি অর্ডারের বিবরণ নিশ্চিত করলে আমি অর্ডার করে দেব।"
        : "Order ta ekhono place kora hoyni. Apni details confirm korle ami order kore dibo.",
  };
}

const AMOUNT = /৳\s*([\d০-৯][\d০-৯,]*(?:\.\d+)?)|([\d০-৯][\d০-৯,]*(?:\.\d+)?)\s*(?:tk|taka|takar|টাকা|bdt)\b/giu;

/** Numbers that appear anywhere in this turn's tool results and the server's session state. */
export function allowedAmounts(sources: unknown[]): Set<number> {
  const set = new Set<number>();
  const visit = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) set.add(Math.round(v * 100) / 100);
    else if (typeof v === "string") for (const m of toAsciiDigits(v).matchAll(/\d[\d,]*(?:\.\d+)?/g)) set.add(Number(m[0].replace(/,/g, "")));
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  sources.forEach(visit);
  return set;
}

/** Amounts in a reply that no tool or session state gave this turn (a customer-supplied amount doesn't count). */
export function unsupportedAmounts(text: string, allowed: Set<number>): number[] {
  const bad: number[] = [];
  for (const m of text.matchAll(AMOUNT)) {
    const n = Number(toAsciiDigits(m[1] ?? m[2] ?? "").replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0 && !allowed.has(n)) bad.push(n);
  }
  return bad;
}

/** Removes unsupported amounts (after the runtime's one retry failed). */
export function stripAmounts(text: string, bad: number[]): string {
  if (!bad.length) return text;
  return text.replace(AMOUNT, (whole, a: string | undefined, b: string | undefined) => {
    const n = Number(toAsciiDigits(a ?? b ?? "").replace(/,/g, ""));
    return bad.includes(n) ? "" : whole;
  }).replace(/\s{2,}/g, " ").trim();
}

const PAYMENT_CLAIM =
  /payment[^.।\n]{0,25}\b(?:received|confirmed|verified|got it)\b|(?:taka|payment)[^.।\n]{0,15}(?:peyechi|pelam|paisi|confirm hoyeche)|(?:পেমেন্ট|টাকা)[^.।\n]{0,20}(?:পেয়েছি|পেলাম|নিশ্চিত হয়েছে|কনফার্ম হয়েছে|ভেরিফাই)/i;

/** No reply may say a payment was received or verified: only a human approves payments, and none exist at launch. */
export function guardPaymentClaim(text: string, script: Script): { text: string; blocked: boolean } {
  if (!PAYMENT_CLAIM.test(text)) return { text, blocked: false };
  return {
    blocked: true,
    text: script === "bangla" ? "পেমেন্টের বিষয়টি আমাদের টিম দেখে আপনাকে জানাবে।" : "Payment er bishoy ta amader team check kore apnake janabe.",
  };
}

/** A promise that a person will reply or help: the runtime makes it true with a real handoff. */
export const PROMISES_HUMAN =
  /(team|টিম|প্রতিনিধি|team member|manush|মানুষ)[^.।]{0,60}(reply|uttor|sahajjo|সাহায্য|উত্তর|jogajog|যোগাযোগ|help|update|contact)/i;

/** Whether a reply shows this grand total (ASCII or Bangla digits, with or without thousands separators). */
export function quoteShownIn(text: string, grandTotal: number): boolean {
  const amounts = toAsciiDigits(text).match(/\d[\d,]*(?:\.\d+)?/g) || [];
  return amounts.some((a) => Number(a.replace(/,/g, "")) === grandTotal);
}

/** 1,000 characters at most, cut at the last sentence end before that. */
export function capLength(text: string, max = 1000): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("। "), cut.lastIndexOf("? "), cut.lastIndexOf("! "), cut.lastIndexOf("\n"));
  return (end > max * 0.5 ? cut.slice(0, end + 1) : cut).trim();
}
