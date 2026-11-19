/**
 * The Owner Assistant's offline answer (ADR-127): used when no model is configured (demo / not configured), when the
 * workspace's AI budget is spent, and when a model answer fails the grounding check. Keyword routing (English,
 * Banglish, Bangla) picks at most two tools, and fixed wording prints their numbers, so every number is the store's.
 */
import type { Period } from "./periods";
import { runOwnerTool, toolsFor, type OwnerPrincipal, type OwnerToolResult } from "./owner-tools";

export type Script = "bangla" | "latin";

export function scriptOf(text: string): Script {
  return /[ঀ-৿]/.test(text) ? "bangla" : "latin";
}

export function detectPeriod(text: string): Period | undefined {
  const t = text.toLowerCase();
  if (/last month|ager mash|gato mash|গত মাস|আগের মাস/.test(t)) return "last_month";
  if (/this month|ei mash|এই মাস|month|mash\b|মাসে/.test(t)) return "this_month";
  if (/30 days|30 din|৩০ দিন|thirty days/.test(t)) return "last_30_days";
  if (/week|7 days|7 din|soptah|সপ্তাহ|৭ দিন/.test(t)) return "last_7_days";
  if (/yesterday|gotokal|gotokaal|kal\b|গতকাল|কাল/.test(t)) return "yesterday";
  if (/today|aj\b|aaj|ajke|আজ/.test(t)) return "today";
  return undefined;
}

const TOPICS: Array<{ tool: string; pattern: RegExp }> = [
  { tool: "get_low_stock", pattern: /stock|restock|inventory|reorder|sold out|stok|স্টক|মজুদ|শেষ হয়ে/ },
  { tool: "get_top_products", pattern: /top|best|most sold|best ?sell|popular|beshi bikri|সবচেয়ে বেশি|জনপ্রিয়|টপ/ },
  { tool: "get_delivery_issues", pattern: /deliver|courier|shipment|parcel|rto|failed delivery|ডেলিভারি|কুরিয়ার|পার্সেল/ },
  { tool: "get_returns_summary", pattern: /return|refund|ferot|ফেরত|রিটার্ন/ },
  { tool: "get_cod_outstanding", pattern: /cod|cash on delivery|cash|reconcil|ক্যাশ|টাকা পাওনা/ },
  { tool: "get_open_escalations", pattern: /escalat|waiting|handoff|human|chat|customer waiting|অপেক্ষা|চ্যাট/ },
  { tool: "get_sales_summary", pattern: /sale|sell|sold|revenue|order|income|earn|bikri|bikroy|ay\b|বিক্রি|অর্ডার|আয়|রেভিনিউ/ },
];

/** Tools a question asks about, in order of relevance (at most two). Defaults to the sales summary. */
export function detectTools(text: string): string[] {
  const t = text.toLowerCase();
  const hits = TOPICS.filter((x) => x.pattern.test(t)).map((x) => x.tool);
  return (hits.length ? hits : ["get_sales_summary"]).slice(0, 2);
}

const PERIOD_LABEL: Record<Period, { latin: string; bangla: string }> = {
  today: { latin: "Today", bangla: "আজ" },
  yesterday: { latin: "Yesterday", bangla: "গতকাল" },
  last_7_days: { latin: "Last 7 days", bangla: "গত ৭ দিন" },
  last_30_days: { latin: "Last 30 days", bangla: "গত ৩০ দিন" },
  this_month: { latin: "This month", bangla: "এই মাস" },
  last_month: { latin: "Last month", bangla: "গত মাস" },
};

const money = (n: unknown) => `৳${Number(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const num = (n: unknown) => Number(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

function changeText(c: unknown, s: Script): string {
  const ch = c as { change?: number; change_pct?: number | null } | undefined;
  if (!ch || ch.change === undefined) return "";
  if (ch.change === 0) return s === "bangla" ? " (আগের মতোই)" : " (same as before)";
  const dir = ch.change > 0 ? (s === "bangla" ? "বেশি" : "up") : s === "bangla" ? "কম" : "down";
  const pct = ch.change_pct === null || ch.change_pct === undefined ? "" : ` ${num(Math.abs(ch.change_pct))}%`;
  return s === "bangla" ? ` (আগের তুলনায়${pct} ${dir})` : ` (${dir}${pct} vs the period before)`;
}

/** Fixed wording for one tool result. Every number printed is a value from `r`. */
export function formatToolResult(tool: string, r: OwnerToolResult, s: Script): string {
  const label = r.period ? PERIOD_LABEL[r.period as Period]?.[s] ?? String(r.period) : "";
  const b = s === "bangla";
  switch (tool) {
    case "get_sales_summary":
      return b
        ? `${label}: ${num(r.orders)}টি অর্ডার${changeText(r.orders_change, s)}, বিক্রি ${money(r.revenue_bdt)}${changeText(r.revenue_change, s)}। বাতিল ${num(r.cancelled)}টি, গড় অর্ডার ${money(r.average_order_bdt)}।`
        : `${label}: ${num(r.orders)} orders${changeText(r.orders_change, s)}, revenue ${money(r.revenue_bdt)}${changeText(r.revenue_change, s)}. ${num(r.cancelled)} cancelled, average order ${money(r.average_order_bdt)}.`;
    case "get_top_products": {
      const list = (r.products as Array<Record<string, unknown>>) ?? [];
      if (!list.length) return b ? `${label}: কোনো বিক্রি নেই।` : `${label}: no sales.`;
      const lines = list.map((p) => `${num(p.rank)}. ${p.product}: ${num(p.units)} ${b ? "পিস" : "units"}, ${money(p.sales_bdt)}`);
      return `${b ? `${label} সবচেয়ে বেশি বিক্রি:` : `${label}, best sellers:`}\n${lines.join("\n")}`;
    }
    case "get_low_stock": {
      const items = (r.items as Array<Record<string, unknown>>) ?? [];
      if (!items.length) return b ? "কোনো পণ্যের স্টক কম নেই।" : "Nothing is at or below its reorder point.";
      const lines = items.map((i) => {
        const left = i.days_of_stock_left === null ? "" : b ? `, প্রায় ${num(i.days_of_stock_left)} দিনের স্টক` : `, about ${num(i.days_of_stock_left)} days left`;
        return `• ${i.product}: ${num(i.available)} ${b ? "বাকি" : "left"}${left}`;
      });
      return `${b ? `স্টক কম: ${num(r.low_stock_items)}টি পণ্য (শেষ: ${num(r.sold_out_items)}টি)` : `Low stock: ${num(r.low_stock_items)} items (${num(r.sold_out_items)} sold out)`}\n${lines.join("\n")}`;
    }
    case "get_delivery_issues":
      return b
        ? `${label}: ${num(r.shipments)}টি পার্সেল; ডেলিভারি ${num(r.delivered)}, ব্যর্থ ${num(r.failed)}, ফেরত ${num(r.returned)}, পথে ${num(r.in_transit)}।`
        : `${label}: ${num(r.shipments)} shipments; ${num(r.delivered)} delivered, ${num(r.failed)} failed, ${num(r.returned)} returned, ${num(r.in_transit)} in transit.`;
    case "get_returns_summary": {
      const reasons = ((r.top_reasons as Array<{ reason: string; count: number }>) ?? []).map((x) => `${x.reason} (${num(x.count)})`).join(", ");
      return b
        ? `${label}: ${num(r.returns)}টি রিটার্ন অনুরোধ${reasons ? `। কারণ: ${reasons}` : ""}।`
        : `${label}: ${num(r.returns)} return requests${reasons ? `. Reasons: ${reasons}` : ""}.`;
    }
    case "get_cod_outstanding":
      return b ? `কুরিয়ার থেকে এখনও মেলানো হয়নি এমন ক্যাশ অন ডেলিভারি: ${money(r.unreconciled_cod_bdt)}।` : `Cash on delivery not yet reconciled from couriers: ${money(r.unreconciled_cod_bdt)}.`;
    case "get_open_escalations":
      return b
        ? `মানুষের উত্তরের অপেক্ষায় ${num(r.open_escalations)}টি চ্যাট${r.oldest_waiting_minutes !== null ? `; সবচেয়ে পুরনোটি ${num(r.oldest_waiting_minutes)} মিনিট ধরে` : ""}।`
        : `${num(r.open_escalations)} customer chats waiting for a person${r.oldest_waiting_minutes !== null ? `; the oldest has waited ${num(r.oldest_waiting_minutes)} minutes` : ""}.`;
    default:
      return "";
  }
}

export interface BasicAnswer {
  answer: string;
  toolsUsed: string[];
  results: OwnerToolResult[];
}

/** Answers from the tools a question asks about, with fixed wording. */
export async function basicAnswer(pr: OwnerPrincipal, question: string): Promise<BasicAnswer> {
  const s = scriptOf(question);
  const period = detectPeriod(question);
  const allowed = new Set(toolsFor(pr).map((t) => t.def.name));
  const wanted = detectTools(question).filter((t) => allowed.has(t));
  if (!wanted.length) {
    return {
      answer: s === "bangla" ? "এই তথ্য দেখার অনুমতি আপনার রোলে নেই।" : "Your role can't see this information.",
      toolsUsed: [],
      results: [],
    };
  }
  const parts: string[] = [];
  const results: OwnerToolResult[] = [];
  for (const tool of wanted) {
    const input = tool === "get_cod_outstanding" || tool === "get_open_escalations" || tool === "get_low_stock" ? {} : period ? { period } : {};
    const out = await runOwnerTool(pr, tool, input);
    if (!out.ok) continue;
    results.push(out.result);
    parts.push(formatToolResult(tool, out.result, s));
  }
  if (!parts.length) {
    return { answer: s === "bangla" ? "এই মুহূর্তে তথ্যটি পড়া যাচ্ছে না।" : "That information couldn't be read right now.", toolsUsed: wanted, results };
  }
  return { answer: parts.join("\n\n"), toolsUsed: wanted, results };
}
