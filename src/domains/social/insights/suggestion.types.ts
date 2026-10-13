/** A recommendation derived from the tenant's own metrics. `evidence` carries the numbers it was based on. */
export interface InsightSuggestion {
  id: string;
  severity: "critical" | "warning" | "opportunity" | "info";
  title: string;
  detail: string;
  action: string;
  evidence: string;
  scope?: string;
}

export type SourceStatus = "LIVE" | "NOT_CONNECTED" | "ERROR";

export const ALLOWED_RANGE_DAYS = [7, 14, 30, 90] as const;

export function parseRangeDays(raw: string | null): number {
  const n = Number(raw);
  return (ALLOWED_RANGE_DAYS as readonly number[]).includes(n) ? n : 30;
}
