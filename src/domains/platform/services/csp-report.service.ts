/**
 * Content-Security-Policy violation reports (FX-86, audit F27). Browsers post them to /api/v1/csp-report while the
 * policy is Report-Only; once a full week passes with none, CSP_ENFORCE=1 switches the header to enforcing.
 * Only the day, the violated directive and the blocked origin are kept (no page URLs, no script samples).
 */
import { db } from "@/infrastructure/db";

const DAY = 24 * 60 * 60_000;

/** The origin of a blocked URI, or the CSP keyword ("inline", "eval", "data"). Never a path or query. */
export function blockedOrigin(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim().slice(0, 300) : "";
  if (!v) return "unknown";
  if (/^(inline|eval|data|blob|self|wasm-eval|trusted-types-policy|trusted-types-sink)$/i.test(v)) return v.toLowerCase();
  try {
    return new URL(v).origin.slice(0, 120);
  } catch {
    return v.split(/[/?#]/)[0].slice(0, 60) || "unknown";
  }
}

/** Reads the classic `{ "csp-report": {...} }` body or a Reporting API array; returns the violations found (at most 20). */
export function parseCspReports(body: unknown): Array<{ directive: string; blocked: string }> {
  const items: Array<Record<string, unknown>> = [];
  if (Array.isArray(body)) {
    for (const r of body.slice(0, 20)) {
      const rec = r as { type?: string; body?: Record<string, unknown> };
      if (rec?.type === "csp-violation" && rec.body && typeof rec.body === "object") items.push(rec.body);
    }
  } else if (body && typeof body === "object" && (body as Record<string, unknown>)["csp-report"]) {
    items.push((body as Record<string, Record<string, unknown>>)["csp-report"]);
  }
  return items.map((i) => ({
    directive: String(i["effective-directive"] ?? i.effectiveDirective ?? i["violated-directive"] ?? "unknown").split(" ")[0].slice(0, 40),
    blocked: blockedOrigin(i["blocked-uri"] ?? i.blockedURL),
  }));
}

/** Counter for reports that couldn't be counted (rate-limited, or the day's distinct counters were full). */
export const DROPPED = "__dropped__";

export class CspReportService {
  public static record(body: unknown, now = Date.now()): number {
    return this.recordParsed(parseCspReports(body), now);
  }

  public static recordParsed(violations: Array<{ directive: string; blocked: string }>, now = Date.now()): number {
    const at = new Date(now).toISOString();
    let n = 0;
    for (const v of violations) {
      if (db.recordCspViolation(at.slice(0, 10), v.directive, v.blocked, at)) n++;
      else this.recordDropped(1, now);
    }
    return n;
  }

  public static recordDropped(count: number, now = Date.now()): void {
    const at = new Date(now).toISOString();
    for (let i = 0; i < Math.min(count, 20); i++) db.recordCspViolation(at.slice(0, 10), DROPPED, DROPPED, at, true);
  }

  /** Violations of the last 7 days, and whether the policy can be enforced (none for 7 full days). */
  public static summary(now = Date.now()): { last_7_days: number; dropped_last_7_days: number; by_directive: Record<string, number>; ready_to_enforce: boolean; enforcing: boolean } {
    const since = new Date(now - 7 * DAY).toISOString().slice(0, 10);
    const rows = db.getCspReports(since);
    const byDirective: Record<string, number> = {};
    let dropped = 0;
    for (const r of rows) {
      if (r.directive === DROPPED) dropped += r.count;
      else byDirective[r.directive] = (byDirective[r.directive] ?? 0) + r.count;
    }
    const total = rows.filter((r) => r.directive !== DROPPED).reduce((n, r) => n + r.count, 0);
    // Reports that couldn't be counted might have been violations: the week isn't clean
    return { last_7_days: total, dropped_last_7_days: dropped, by_directive: byDirective, ready_to_enforce: total === 0 && dropped === 0, enforcing: process.env.CSP_ENFORCE === "1" };
  }
}
