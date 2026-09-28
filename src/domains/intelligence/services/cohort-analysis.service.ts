/**
 * CommerceOS Phase 6: Cohort Analysis Service
 * Monthly customer acquisition cohorts, retention rates, and revenue decay curves.
 */

import { db } from "@/infrastructure/db";
import { CohortRecord, CohortPeriodData } from "@/types/intelligence";
import { intelligenceSnapshots } from "./intelligence-snapshot.service";

export class CohortAnalysisService {
  /**
   * Evaluates customer cohorts based on first purchase month and stores them (one write).
   */
  public analyzeCohorts(tenantId: string): CohortRecord[] {
    return intelligenceSnapshots.persist(tenantId, "cohorts", this.computeCohorts(tenantId));
  }

  /** Pure (FX-21): monthly acquisition cohorts, scoped to the tenant. */
  public computeCohorts(tenantId: string): CohortRecord[] {
    const orders = db.getAllOrders(tenantId, { hydrate: true }).filter((o) => o.status !== "CANCELLED");

    // 1. Determine each customer's first purchase month
    const customerFirstMonth: Record<string, string> = {};
    const customerOrdersByMonth: Record<string, Set<string>> = {}; // "YYYY-MM" -> Set of customer IDs
    const monthlyRevenueByCohort: Record<string, Record<number, number>> = {}; // cohortMonth -> periodIndex -> revenue

    for (const o of orders) {
      if (!o.customer_id || !o.created_at) continue;
      const month = o.created_at.slice(0, 7); // "YYYY-MM"

      if (!customerFirstMonth[o.customer_id] || o.created_at < customerFirstMonth[o.customer_id]) {
        customerFirstMonth[o.customer_id] = month;
      }
    }

    // 2. Map orders to cohort periods
    const cohortSizes: Record<string, Set<string>> = {};

    for (const o of orders) {
      if (!o.customer_id || !o.created_at) continue;
      const firstMonth = customerFirstMonth[o.customer_id];
      if (!firstMonth) continue;

      if (!cohortSizes[firstMonth]) cohortSizes[firstMonth] = new Set();
      cohortSizes[firstMonth].add(o.customer_id);

      const orderMonth = o.created_at.slice(0, 7);
      const periodIndex = this.calculateMonthDiff(firstMonth, orderMonth);

      if (periodIndex >= 0) {
        if (!monthlyRevenueByCohort[firstMonth]) monthlyRevenueByCohort[firstMonth] = {};
        monthlyRevenueByCohort[firstMonth][periodIndex] =
          (monthlyRevenueByCohort[firstMonth][periodIndex] || 0) + (o.grand_total || (o as any).total_amount || 0);

        const key = `${firstMonth}:${periodIndex}`;
        if (!customerOrdersByMonth[key]) customerOrdersByMonth[key] = new Set();
        customerOrdersByMonth[key].add(o.customer_id);
      }
    }

    // 3. Construct CohortRecords
    const records: CohortRecord[] = [];
    const sortedCohorts = Object.keys(cohortSizes).sort();

    for (const cohortMonth of sortedCohorts) {
      const initialSize = cohortSizes[cohortMonth].size;
      const periods: CohortPeriodData[] = [];

      // Generate up to 6 periods (Month 0 to Month 5)
      for (let p = 0; p <= 5; p++) {
        const key = `${cohortMonth}:${p}`;
        const activeCount = customerOrdersByMonth[key]?.size || 0;
        const revenue = monthlyRevenueByCohort[cohortMonth]?.[p] || 0;
        const retentionRate = initialSize > 0 ? Number(((activeCount / initialSize) * 100).toFixed(1)) : 0;

        periods.push({
          period_index: p,
          active_customers: activeCount,
          retention_rate_pct: retentionRate,
          revenue_bdt: Number(revenue.toFixed(2)),
        });
      }

      const cohortRecord: CohortRecord = {
        id: `coh_${tenantId}_${cohortMonth}`,
        tenant_id: tenantId,
        cohort_month: cohortMonth,
        initial_size: initialSize,
        periods,
      };

      records.push(cohortRecord);
    }

    return records;
  }

  private calculateMonthDiff(monthA: string, monthB: string): number {
    const [yA, mA] = monthA.split("-").map(Number);
    const [yB, mB] = monthB.split("-").map(Number);
    return (yB - yA) * 12 + (mB - mA);
  }
}

export const cohortAnalysisService = new CohortAnalysisService();
