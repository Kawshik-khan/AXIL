/**
 * CommerceOS Phase 6: Customer Intelligence Service
 * RFM Quantile Segmentation, Churn Signals, and Observed vs Predicted LTV.
 */

import { db } from "@/infrastructure/db";
import type { Order } from "@/types/commerce";
import { CustomerIntelligenceRecord, RFMSegment } from "@/types/intelligence";
import { intelligenceSnapshots } from "./intelligence-snapshot.service";

export class CustomerIntelligenceService {
  /**
   * Evaluates RFM scores and lifetime value for all customers of a tenant and stores the snapshot (one write).
   */
  public analyzeCustomers(tenantId: string): CustomerIntelligenceRecord[] {
    return intelligenceSnapshots.persist(tenantId, "customers", this.computeCustomers(tenantId));
  }

  /**
   * Pure (FX-21): RFM scores and lifetime value for every customer, in O(customers + orders) (FX-22).
   */
  public computeCustomers(tenantId: string): CustomerIntelligenceRecord[] {
    const customers = db.getAllCustomers(tenantId);
    const ordersByCustomer = new Map<string, Order[]>();
    for (const o of db.getAllOrders(tenantId)) {
      if (o.status === "CANCELLED") continue;
      const list = ordersByCustomer.get(o.customer_id);
      if (list) list.push(o);
      else ordersByCustomer.set(o.customer_id, [o]);
    }

    const now = Date.now();
    const records: CustomerIntelligenceRecord[] = [];

    for (const cust of customers) {
      const custOrders = (ordersByCustomer.get(cust.id) ?? []).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      const orderCount = custOrders.length;
      const totalSpent = custOrders.reduce((sum, o) => sum + (o.grand_total || (o as any).total_amount || 0), 0);
      const aov = orderCount > 0 ? Number((totalSpent / orderCount).toFixed(2)) : 0;

      const lastOrderAt = custOrders[0]?.created_at || cust.created_at;
      const firstOrderAt = custOrders[custOrders.length - 1]?.created_at || cust.created_at;

      const recencyDays = Math.max(
        0,
        Math.floor((now - new Date(lastOrderAt).getTime()) / (1000 * 60 * 60 * 24))
      );

      // Quantile Scoring 1-5
      // 1. Recency
      let rScore = 1;
      if (recencyDays <= 14) rScore = 5;
      else if (recencyDays <= 30) rScore = 4;
      else if (recencyDays <= 60) rScore = 3;
      else if (recencyDays <= 90) rScore = 2;

      // 2. Frequency
      let fScore = 1;
      if (orderCount >= 5) fScore = 5;
      else if (orderCount >= 4) fScore = 4;
      else if (orderCount >= 3) fScore = 3;
      else if (orderCount >= 2) fScore = 2;

      // 3. Monetary
      let mScore = 1;
      if (totalSpent >= 10000) mScore = 5;
      else if (totalSpent >= 5000) mScore = 4;
      else if (totalSpent >= 3000) mScore = 3;
      else if (totalSpent >= 1500) mScore = 2;

      // Segment Assignment
      let segment: RFMSegment = "RECENT_CUSTOMERS";
      if (rScore >= 4 && fScore >= 4 && mScore >= 4) {
        segment = "CHAMPIONS";
      } else if (fScore >= 3 && mScore >= 3) {
        segment = "LOYAL_CUSTOMERS";
      } else if (rScore >= 4 && fScore <= 2 && mScore >= 3) {
        segment = "POTENTIAL_LOYALISTS";
      } else if (rScore <= 2 && fScore >= 3) {
        segment = "AT_RISK";
      } else if (rScore <= 2 && fScore <= 2 && mScore >= 2) {
        segment = "HIBERNATING";
      } else if (rScore === 1 && fScore === 1) {
        segment = "LOST";
      } else if (rScore >= 4 && fScore === 1) {
        segment = "RECENT_CUSTOMERS";
      } else {
        segment = "NEED_ATTENTION";
      }

      // Observed vs Predicted LTV
      const observedLtv = Number(totalSpent.toFixed(2));
      // Predictive LTV model: Observed LTV + (Estimated future purchases based on frequency)
      const repeatPropensity = fScore >= 3 ? 1.8 : fScore === 2 ? 1.3 : 1.1;
      const estimatedLtv = Number((observedLtv * repeatPropensity).toFixed(2));

      // Churn probability
      let churnProb = 0.1;
      if (rScore === 1) churnProb = 0.85;
      else if (rScore === 2) churnProb = 0.6;
      else if (rScore === 3) churnProb = 0.35;
      else if (rScore === 4) churnProb = 0.2;

      const record: CustomerIntelligenceRecord = {
        id: `ci_${cust.id}_${tenantId}`,
        tenant_id: tenantId,
        customer_id: cust.id,
        customer_name: `${cust.first_name || ""} ${cust.last_name || ""}`.trim() || "Valued Customer",
        phone: cust.phone || "",
        recency_days: recencyDays,
        frequency_orders: orderCount,
        monetary_total_bdt: observedLtv,
        aov_bdt: aov,
        r_score: rScore,
        f_score: fScore,
        m_score: mScore,
        rfm_segment: segment,
        observed_ltv_bdt: observedLtv,
        estimated_ltv_bdt: estimatedLtv,
        churn_probability: churnProb,
        first_order_at: firstOrderAt,
        last_order_at: lastOrderAt,
        preferred_channel: (custOrders[0]?.source as string) || "WEBSITE",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      records.push(record);
    }

    return records;
  }
}

export const customerIntelligenceService = new CustomerIntelligenceService();
