/**
 * Grounding check for Owner Assistant answers (ADR-127): every number in a model-written answer must be a number some
 * tool returned in that turn. Numbers in the owner's question don't count: a figure typed into a question ("we sold
 * ৳90,000 today, right?") must not come back as the shop's figure (PR #83 review). Revenue, counts and stock come
 * from the store, never from the model or the question. Bangla digits and thousands separators are normalised first.
 */

const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";

export function normaliseDigits(text: string): string {
  return text.replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)));
}

/** Numbers written in text: "1,234.50" → 1234.5, "৳৫০০" → 500. A leading "-" is treated as a separator. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const match of normaliseDigits(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(match[0].replace(/,/g, "")); // 1,234 and the lakh style 1,23,456 both
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Every number in a tool result, recursively: numeric values and numbers inside strings (dates, labels). */
export function numbersInValue(value: unknown, into: number[] = []): number[] {
  if (typeof value === "number" && Number.isFinite(value)) into.push(Math.abs(value));
  else if (typeof value === "string") into.push(...numbersIn(value));
  else if (Array.isArray(value)) for (const v of value) numbersInValue(v, into);
  else if (value && typeof value === "object") for (const v of Object.values(value)) numbersInValue(v, into);
  return into;
}

function variants(n: number): number[] {
  return [n, Math.round(n), Math.round(n * 10) / 10, Math.round(n * 100) / 100, Math.floor(n), Math.ceil(n)];
}

export interface GroundingResult {
  grounded: boolean;
  /** Numbers in the answer that no tool returned, as written. */
  ungrounded: string[];
}

/**
 * Checks an answer against the tool results of its turn. List markers at the start of a line ("1." / "2)") are not
 * claims and are skipped.
 */
export function checkGrounding(answer: string, toolResults: unknown[]): GroundingResult {
  const allowed = new Set<number>();
  for (const n of numbersInValue(toolResults)) for (const v of variants(n)) allowed.add(v);

  const ungrounded: string[] = [];
  const text = normaliseDigits(answer).replace(/^\s*\d{1,2}[.)]\s/gm, " ");
  for (const match of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const raw = match[0];
    const n = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    if (!variants(n).some((v) => allowed.has(v))) ungrounded.push(raw);
  }
  return { grounded: ungrounded.length === 0, ungrounded: [...new Set(ungrounded)] };
}
