import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 7: Customer Lifecycle State Machine Service
 * Governs the 10 deterministic customer lifecycle stages and event-driven transitions.
 */

import { db } from "@/infrastructure/db";
import {
  LifecycleStage,
  CustomerLifecycleRecord,
  CustomerLifecycleTransition,
} from "@/types/growth";

export class CustomerLifecycleService {
  /**
   * Computes the deterministic lifecycle stage for a customer based on orders & recency
   */
  public determineLifecycleStage(params: {
    orderCount: number;
    totalSpendBdt: number;
    daysSinceLastOrder: number;
    currentStage?: LifecycleStage;
  }): LifecycleStage {
    const { orderCount, totalSpendBdt, daysSinceLastOrder, currentStage } = params;

    // 0 orders
    if (orderCount === 0) {
      return "PROSPECT";
    }

    // Reactivation check: if customer was previously DORMANT or CHURNED, and bought recently
    if (
      (currentStage === "DORMANT" || currentStage === "CHURNED" || currentStage === "AT_RISK") &&
      daysSinceLastOrder <= 14
    ) {
      return "REACTIVATED";
    }

    // Inactivity rules for existing purchasers
    if (daysSinceLastOrder > 120) {
      return "CHURNED";
    }
    if (daysSinceLastOrder > 60) {
      return "DORMANT";
    }
    if (daysSinceLastOrder > 30) {
      return "AT_RISK";
    }

    // Active customer tiering
    if (orderCount >= 5 || totalSpendBdt >= 25000) {
      return "LOYAL";
    }
    if (orderCount >= 2) {
      return "REPEAT";
    }
    if (orderCount === 1) {
      return daysSinceLastOrder <= 7 ? "FIRST_PURCHASE" : "ACTIVE";
    }

    return "ACTIVE";
  }

  /**
   * Evaluates and transitions customer lifecycle state, logging audit transitions
   */
  public evaluateCustomerLifecycle(
    tenantId: string,
    customerId: string,
    triggerEvent: string = "manual.eval"
  ): CustomerLifecycleRecord {
    const orders = db.getOrders(tenantId).orders.filter((o) => o.customer_id === customerId);
    const existing = db.getCustomerLifecycleByCustomerId(tenantId, customerId);

    const totalSpend = orders.reduce((sum, o) => sum + (o.grand_total || 0), 0);
    const orderCount = orders.length;
    const aov = orderCount > 0 ? Math.round(totalSpend / orderCount) : 0;

    const timestamps = orders
      .map((o) => new Date(o.created_at).getTime())
      .filter((t) => !isNaN(t))
      .sort((a, b) => b - a);

    const now = Date.now();
    const daysSinceLastOrder = timestamps.length > 0 ? Math.floor((now - timestamps[0]) / 86400000) : 999;
    const lastOrderAt = timestamps.length > 0 ? new Date(timestamps[0]).toISOString() : undefined;

    const newStage = this.determineLifecycleStage({
      orderCount,
      totalSpendBdt: totalSpend,
      daysSinceLastOrder,
      currentStage: existing?.stage,
    });

    const isTransition = !existing || existing.stage !== newStage;

    if (isTransition) {
      const transition: CustomerLifecycleTransition = {
        id: `clt_${Date.now()}_${randomSuffix()}`,
        tenant_id: tenantId,
        customer_id: customerId,
        from_stage: existing?.stage || "PROSPECT",
        to_stage: newStage,
        trigger_event: triggerEvent,
        reason: existing
          ? `Lifecycle transition from ${existing.stage} to ${newStage} triggered by ${triggerEvent}. Days inactive: ${daysSinceLastOrder}.`
          : `Initial lifecycle stage assignment to ${newStage} triggered by ${triggerEvent}.`,
        transitioned_at: new Date().toISOString(),
      };
      db.insertLifecycleTransition(transition);
    }

    const churnRisk = daysSinceLastOrder > 90 ? 0.85 : daysSinceLastOrder > 45 ? 0.55 : 0.15;
    const predictedLtv = Math.round(totalSpend * (orderCount > 2 ? 1.8 : 1.3));

    const record: CustomerLifecycleRecord = {
      id: existing?.id || `cl_${Date.now()}_${customerId}`,
      tenant_id: tenantId,
      customer_id: customerId,
      stage: newStage,
      previous_stage: existing?.stage,
      stage_entered_at: isTransition ? new Date().toISOString() : existing?.stage_entered_at || new Date().toISOString(),
      days_in_current_stage: isTransition ? 0 : existing ? Math.floor((now - new Date(existing.stage_entered_at).getTime()) / 86400000) : 0,
      order_count: orderCount,
      total_revenue_bdt: totalSpend,
      average_order_value_bdt: aov,
      last_order_at: lastOrderAt,
      predicted_churn_risk: churnRisk,
      predicted_ltv_12m_bdt: predictedLtv,
      created_at: existing?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    db.upsertCustomerLifecycle(record);
    return record;
  }

  /**
   * Evaluates all customers in a tenant and computes distribution with O(N) performance
   */
  public evaluateAllCustomers(tenantId: string): {
    totalEvaluated: number;
    distribution: Record<LifecycleStage, number>;
  } {
    const customers = db.getCustomers(tenantId).customers;
    const allOrders = db.getOrders(tenantId).orders;
    const existingLifecycles = db.getCustomerLifecycles(tenantId);

    // Build O(1) order lookup map by customer_id
    const ordersByCustomer = new Map<string, typeof allOrders>();
    for (const order of allOrders) {
      if (!order.customer_id) continue;
      let list = ordersByCustomer.get(order.customer_id);
      if (!list) {
        list = [];
        ordersByCustomer.set(order.customer_id, list);
      }
      list.push(order);
    }

    // Build O(1) existing lifecycle lookup map
    const lifecycleMap = new Map<string, CustomerLifecycleRecord>();
    for (const life of existingLifecycles) {
      lifecycleMap.set(life.customer_id, life);
    }

    const distribution: Record<LifecycleStage, number> = {
      PROSPECT: 0,
      NEW: 0,
      FIRST_PURCHASE: 0,
      ACTIVE: 0,
      REPEAT: 0,
      LOYAL: 0,
      AT_RISK: 0,
      DORMANT: 0,
      CHURNED: 0,
      REACTIVATED: 0,
    };

    const recordsToSave: CustomerLifecycleRecord[] = [];
    const transitionsToSave: CustomerLifecycleTransition[] = [];
    const now = Date.now();
    const nowIso = new Date().toISOString();

    for (const c of customers) {
      const orders = ordersByCustomer.get(c.id) || [];
      const existing = lifecycleMap.get(c.id);

      const totalSpend = orders.reduce((sum, o) => sum + (o.grand_total || 0), 0);
      const orderCount = orders.length;
      const aov = orderCount > 0 ? Math.round(totalSpend / orderCount) : 0;

      const timestamps = orders
        .map((o) => new Date(o.created_at).getTime())
        .filter((t) => !isNaN(t))
        .sort((a, b) => b - a);

      const daysSinceLastOrder = timestamps.length > 0 ? Math.floor((now - timestamps[0]) / 86400000) : 999;
      const lastOrderAt = timestamps.length > 0 ? new Date(timestamps[0]).toISOString() : undefined;

      const newStage = this.determineLifecycleStage({
        orderCount,
        totalSpendBdt: totalSpend,
        daysSinceLastOrder,
        currentStage: existing?.stage,
      });

      distribution[newStage] = (distribution[newStage] || 0) + 1;

      const isTransition = !existing || existing.stage !== newStage;
      if (isTransition) {
        transitionsToSave.push({
          id: `clt_${now}_${c.id}`,
          tenant_id: tenantId,
          customer_id: c.id,
          from_stage: existing?.stage || "PROSPECT",
          to_stage: newStage,
          trigger_event: "batch.evaluation",
          reason: existing
            ? `Lifecycle transition from ${existing.stage} to ${newStage}. Days inactive: ${daysSinceLastOrder}.`
            : `Initial lifecycle stage assignment to ${newStage}.`,
          transitioned_at: nowIso,
        });
      }

      const churnRisk = daysSinceLastOrder > 90 ? 0.85 : daysSinceLastOrder > 45 ? 0.55 : 0.15;
      const predictedLtv = Math.round(totalSpend * (orderCount > 2 ? 1.8 : 1.3));

      recordsToSave.push({
        id: existing?.id || `cl_${c.id}`,
        tenant_id: tenantId,
        customer_id: c.id,
        stage: newStage,
        previous_stage: existing?.stage,
        stage_entered_at: isTransition ? nowIso : existing?.stage_entered_at || nowIso,
        days_in_current_stage: isTransition ? 0 : existing ? Math.floor((now - new Date(existing.stage_entered_at).getTime()) / 86400000) : 0,
        order_count: orderCount,
        total_revenue_bdt: totalSpend,
        average_order_value_bdt: aov,
        last_order_at: lastOrderAt,
        predicted_churn_risk: churnRisk,
        predicted_ltv_12m_bdt: predictedLtv,
        created_at: existing?.created_at || nowIso,
        updated_at: nowIso,
      });
    }

    if (recordsToSave.length > 0) {
      db.batchUpsertCustomerLifecycles(recordsToSave);
    }
    if (transitionsToSave.length > 0) {
      db.batchInsertLifecycleTransitions(transitionsToSave.slice(0, 500)); // persist recent transition events
    }

    return {
      totalEvaluated: customers.length,
      distribution,
    };
  }

  /**
   * Retrieves lifecycle stage distribution for tenant dashboard
   */
  public getLifecycleDistribution(tenantId: string): Record<LifecycleStage, number> {
    let records = db.getCustomerLifecycles(tenantId);
    if (records.length === 0) {
      try {
        const evalRes = this.evaluateAllCustomers(tenantId);
        return evalRes.distribution;
      } catch (err) {
        console.error("Failed to auto-evaluate lifecycles:", err);
      }
    }

    const dist: Record<LifecycleStage, number> = {
      PROSPECT: 0,
      NEW: 0,
      FIRST_PURCHASE: 0,
      ACTIVE: 0,
      REPEAT: 0,
      LOYAL: 0,
      AT_RISK: 0,
      DORMANT: 0,
      CHURNED: 0,
      REACTIVATED: 0,
    };

    for (const r of records) {
      dist[r.stage] = (dist[r.stage] || 0) + 1;
    }

    return dist;
  }
}

export const customerLifecycleService = new CustomerLifecycleService();
