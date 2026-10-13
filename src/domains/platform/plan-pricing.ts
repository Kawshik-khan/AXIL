/**
 * Plan version pricing and status, read the same way everywhere (console, MRR, subscriptions). Legacy versions carry
 * one price (`price_bdt` + `billing_period`) and `is_published`; new versions carry monthly/annual prices and a status.
 * Pure functions on records: safe to import from client components.
 */
import type { PlanVersionRecord, SubscriptionRecord } from "@/types/platform";

export type PlanVersionStatus = "DRAFT" | "PUBLISHED" | "RETIRED";

export function versionStatus(v: Pick<PlanVersionRecord, "status" | "is_published">): PlanVersionStatus {
  return v.status ?? (v.is_published ? "PUBLISHED" : "DRAFT");
}

/** The monthly price, or null when the version isn't sold monthly. */
export function monthlyPrice(v: PlanVersionRecord): number | null {
  if (v.monthly_price_bdt !== undefined) return v.monthly_price_bdt;
  return v.billing_period === "MONTHLY" ? v.price_bdt : null;
}

/** The annual price, or null when the version isn't sold annually. */
export function annualPrice(v: PlanVersionRecord): number | null {
  if (v.annual_price_bdt !== undefined) return v.annual_price_bdt;
  return v.billing_period === "ANNUAL" ? v.price_bdt : null;
}

/** The billing period a subscription pays: its own, else the only period the version is sold in. */
export function subscriptionPeriod(sub: Pick<SubscriptionRecord, "billing_period">, v: PlanVersionRecord): "MONTHLY" | "ANNUAL" {
  if (sub.billing_period) return sub.billing_period;
  if (monthlyPrice(v) !== null) return "MONTHLY";
  return annualPrice(v) !== null ? "ANNUAL" : v.billing_period;
}

/** What one subscription adds to monthly recurring revenue: the monthly price, or the annual price / 12. */
export function mrrContribution(sub: Pick<SubscriptionRecord, "billing_period">, v: PlanVersionRecord): number {
  const period = subscriptionPeriod(sub, v);
  if (period === "ANNUAL") {
    const annual = annualPrice(v);
    return annual === null ? 0 : annual / 12;
  }
  return monthlyPrice(v) ?? 0;
}

/** The latest PUBLISHED version of a plan (highest version number), or undefined. */
export function latestPublished(versions: readonly PlanVersionRecord[]): PlanVersionRecord | undefined {
  return versions
    .filter((v) => versionStatus(v) === "PUBLISHED")
    .reduce<PlanVersionRecord | undefined>((best, v) => (!best || v.version > best.version ? v : best), undefined);
}
