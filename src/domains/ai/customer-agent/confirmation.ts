/**
 * The confirmation gate (FX-73, audit F04 and F28): an order is placed only after the customer says yes in a message
 * that arrived after they were shown the quote. The decision is deterministic; the model never decides it.
 *
 * Deliberately strict, because a false yes places a real order: the yes must open the message, a question is never a
 * yes, and any negation, hesitation or condition anywhere in the message cancels it. "yes, Rahim 017… House 12…"
 * confirms; "ok so how much for 2?", "not sure", "yes but make it 2" and "জিন্স টা কত?" don't.
 */
import { db } from "@/infrastructure/db";

// Word boundaries that understand Bangla: a letter, vowel sign (mark) or digit on either side means "inside a word"
const word = (alternatives: string) => new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{M}\\p{N}])`, "iu");

const AFFIRM_WORDS = [
  "yes", "yeah", "yep", "yup", "ok", "okay", "confirm", "confirmed", "sure", "done", "ji+", "jee", "ha+", "hya",
  "thik ache", "thik ase", "order (?:koren|korun|den|kore den|confirm)",
  "হ্যাঁ", "হ্যা", "জি", "জ্বি", "ঠিক আছে", "কনফার্ম", "অর্ডার করুন", "অর্ডার দিন",
].join("|");
/** A yes that opens the message (after any punctuation or spaces), as a whole word. */
const AFFIRM_AT_START = new RegExp(`^[\\s\\p{P}]*(?:${AFFIRM_WORDS})(?![\\p{L}\\p{M}\\p{N}])`, "iu");

const NEGATE = word(
  [
    "no", "nope", "nah", "not", "don'?t", "dont", "never", "cancel", "stop", "wait", "later", "change", "but", "maybe",
    "pore", "lagbe na", "thak", "na", "kintu", "dekhi", "bhabi",
    "না", "নাহ", "বাতিল", "পরে", "কিন্তু", "লাগবে না", "দেখি", "ভাবি",
  ].join("|")
);

/** Whether one message is a clear yes: it opens with a yes, asks nothing, and takes nothing back. */
export function isAffirmative(text: string): boolean {
  const t = text.normalize("NFC").trim();
  if (!t || /[?？]/.test(t)) return false;
  if (NEGATE.test(t)) return false;
  return AFFIRM_AT_START.test(t);
}

/** The texts of all the customer's messages in a conversation, oldest first (uncapped: the gate compares counts). */
export function customerMessages(tenantId: string, conversationId: string): string[] {
  return db
    .getMessages(tenantId, conversationId, { limit: Number.MAX_SAFE_INTEGER })
    .messages.filter((m) => m.sender_type === "CUSTOMER")
    .map((m) => m.text);
}

/** Whether the customer's latest message is a yes that came after the quote was shown. */
export function confirmedAfter(tenantId: string, conversationId: string, customerMsgCountAtQuote: number): boolean {
  const messages = customerMessages(tenantId, conversationId);
  return messages.length > customerMsgCountAtQuote && isAffirmative(messages[messages.length - 1] ?? "");
}
