/**
 * Report periods in the shop's own timezone (ADR-127). Every Owner Assistant number names its period, and a period
 * also carries the one before it, so "is that up or down?" is answered from data, not guessed.
 */
import { z } from "zod";

export const PERIODS = ["today", "yesterday", "last_7_days", "last_30_days", "this_month", "last_month"] as const;
export const PeriodSchema = z.enum(PERIODS);
export type Period = z.infer<typeof PeriodSchema>;

export interface PeriodWindow {
  period: Period;
  /** Local dates, inclusive, e.g. "2026-11-18". */
  from_date: string;
  to_date: string;
  /** UTC instants: [from, to). */
  from: string;
  to: string;
  /** The window of the same length just before this one, for comparison. */
  previous: { from_date: string; to_date: string; from: string; to: string };
}

const DAY_MS = 86_400_000;

/** The timezone's offset from UTC at `at`, in ms (positive east of UTC). */
function offsetMs(timeZone: string, at: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** "YYYY-MM-DD" in the timezone at instant `at`. */
export function localDate(timeZone: string, at: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(at));
}

/** The UTC instant of local midnight starting `date` ("YYYY-MM-DD") in the timezone. */
function localMidnight(timeZone: string, date: string): number {
  const guess = Date.parse(`${date}T00:00:00Z`);
  // Two passes settle the offset across a DST change on that day
  let instant = guess - offsetMs(timeZone, guess);
  instant = guess - offsetMs(timeZone, instant);
  return instant;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function window(timeZone: string, fromDate: string, toDateInclusive: string) {
  return {
    from_date: fromDate,
    to_date: toDateInclusive,
    from: new Date(localMidnight(timeZone, fromDate)).toISOString(),
    to: new Date(localMidnight(timeZone, addDays(toDateInclusive, 1))).toISOString(),
  };
}

export function resolvePeriod(period: Period, timeZone: string, now = Date.now()): PeriodWindow {
  const tz = timeZone || "Asia/Dhaka";
  const today = localDate(tz, now);
  let fromDate: string;
  let toDate: string;
  let prevFrom: string;
  let prevTo: string;
  switch (period) {
    case "today":
      fromDate = toDate = today;
      prevFrom = prevTo = addDays(today, -1);
      break;
    case "yesterday":
      fromDate = toDate = addDays(today, -1);
      prevFrom = prevTo = addDays(today, -2);
      break;
    case "last_7_days":
      fromDate = addDays(today, -6);
      toDate = today;
      prevFrom = addDays(today, -13);
      prevTo = addDays(today, -7);
      break;
    case "last_30_days":
      fromDate = addDays(today, -29);
      toDate = today;
      prevFrom = addDays(today, -59);
      prevTo = addDays(today, -30);
      break;
    case "this_month": {
      fromDate = `${today.slice(0, 7)}-01`;
      toDate = today;
      // The same number of days at the start of last month
      const lastMonthStart = `${addDays(fromDate, -1).slice(0, 7)}-01`;
      const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / DAY_MS);
      prevFrom = lastMonthStart;
      const candidate = addDays(lastMonthStart, days);
      const lastMonthEnd = addDays(fromDate, -1);
      prevTo = candidate > lastMonthEnd ? lastMonthEnd : candidate;
      break;
    }
    case "last_month": {
      const thisMonthStart = `${today.slice(0, 7)}-01`;
      toDate = addDays(thisMonthStart, -1);
      fromDate = `${toDate.slice(0, 7)}-01`;
      prevTo = addDays(fromDate, -1);
      prevFrom = `${prevTo.slice(0, 7)}-01`;
      break;
    }
  }
  return { period, ...window(tz, fromDate, toDate), previous: window(tz, prevFrom, prevTo) };
}

/** Whole days in a window (for velocity-style tools that take a day count). */
export function periodDays(w: PeriodWindow): number {
  return Math.max(1, Math.round((Date.parse(w.to) - Date.parse(w.from)) / DAY_MS));
}
