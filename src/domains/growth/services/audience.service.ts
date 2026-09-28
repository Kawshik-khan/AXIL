import { AppError } from "@/lib/errors";
import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 7: Segment & Audience Engine Service
 * Deterministic rule evaluation, predictive segment scoring, and tenant-isolated audience management.
 */

import { db } from "@/infrastructure/db";
import {
  Audience,
  AudienceMember,
  AudienceSnapshot,
  AudienceRuleGroup,
  SegmentCondition,
  PredictiveSegmentMetadata,
} from "@/types/growth";
import { customerIntelligenceService } from "@/domains/intelligence/services/customer-intelligence.service";

export class SegmentEngineService {
  /**
   * Evaluates if a customer matches a single condition
   */
  public evaluateCondition(
    context: {
      customer: any;
      orderCount: number;
      totalSpend: number;
      averageOrderValue: number;
      lastPurchaseDaysAgo: number;
      firstPurchaseDaysAgo: number;
      lifecycleStage: string;
      rfmSegment?: string;
      predictedLtvBdt?: number;
      churnRiskLevel?: string;
      purchasedProductIds: string[];
      purchasedCategories: string[];
      hasReturnedOrder: boolean;
      hasFailedPayment: boolean;
      hasAbandonedCart: boolean;
    },
    condition: SegmentCondition
  ): boolean {
    const { field, operator, value } = condition;

    let targetVal: any;
    switch (field) {
      case "total_spend":
        targetVal = context.totalSpend;
        break;
      case "order_count":
        targetVal = context.orderCount;
        break;
      case "average_order_value":
        targetVal = context.averageOrderValue;
        break;
      case "last_purchase_days_ago":
        targetVal = context.lastPurchaseDaysAgo;
        break;
      case "first_purchase_days_ago":
        targetVal = context.firstPurchaseDaysAgo;
        break;
      case "location":
        targetVal = context.customer.city || context.customer.district || "";
        break;
      case "source":
        targetVal = context.customer.source || "ORGANIC";
        break;
      case "lifecycle_stage":
        targetVal = context.lifecycleStage;
        break;
      case "rfm_segment":
        targetVal = context.rfmSegment || "";
        break;
      case "predicted_ltv_bdt":
        targetVal = context.predictedLtvBdt || 0;
        break;
      case "churn_risk_level":
        targetVal = context.churnRiskLevel || "LOW";
        break;
      case "purchased_product_id":
        return context.purchasedProductIds.includes(String(value));
      case "purchased_category":
        return context.purchasedCategories.includes(String(value));
      case "has_returned_order":
        targetVal = context.hasReturnedOrder;
        break;
      case "has_failed_payment":
        targetVal = context.hasFailedPayment;
        break;
      case "has_abandoned_cart":
        targetVal = context.hasAbandonedCart;
        break;
      default:
        return false;
    }

    switch (operator) {
      case "EQUALS":
        return String(targetVal).toLowerCase() === String(value).toLowerCase();
      case "NOT_EQUALS":
        return String(targetVal).toLowerCase() !== String(value).toLowerCase();
      case "GREATER_THAN":
        return Number(targetVal) > Number(value);
      case "GREATER_THAN_OR_EQUAL":
        return Number(targetVal) >= Number(value);
      case "LESS_THAN":
        return Number(targetVal) < Number(value);
      case "LESS_THAN_OR_EQUAL":
        return Number(targetVal) <= Number(value);
      case "CONTAINS":
        return String(targetVal).toLowerCase().includes(String(value).toLowerCase());
      case "IN":
        return Array.isArray(value) && value.map((v) => String(v).toLowerCase()).includes(String(targetVal).toLowerCase());
      case "NOT_IN":
        return Array.isArray(value) && !value.map((v) => String(v).toLowerCase()).includes(String(targetVal).toLowerCase());
      case "WITHIN_LAST_DAYS":
        return typeof targetVal === "number" && targetVal <= Number(value);
      case "BEFORE_DAYS_AGO":
        return typeof targetVal === "number" && targetVal >= Number(value);
      default:
        return false;
    }
  }

  /**
   * Evaluates whether a customer context matches an audience rule group
   */
  public evaluateRuleGroup(context: any, group: AudienceRuleGroup): boolean {
    if (!group.conditions || group.conditions.length === 0) return true;

    if (group.conjunction === "OR") {
      return group.conditions.some((c) => this.evaluateCondition(context, c));
    }
    return group.conditions.every((c) => this.evaluateCondition(context, c));
  }
}

export const segmentEngineService = new SegmentEngineService();

export class AudienceService {
  /**
   * Builds customer evaluation context for a tenant's customers
   */
  private buildCustomerContexts(tenantId: string): any[] {
    const customers = db.getAllCustomers(tenantId);
    const orders = db.getAllOrders(tenantId, { hydrate: true });
    const payments = db.getPayments(tenantId);
    const shipments = db.getShipments(tenantId);
    const lifecycles = db.getCustomerLifecycles(tenantId);

    // Phase 6 RFM / LTV intelligence, computed in memory: evaluating an audience must not store a snapshot (FX-21)
    let intelProfiles: ReturnType<typeof customerIntelligenceService.computeCustomers> = [];
    try {
      intelProfiles = customerIntelligenceService.computeCustomers(tenantId);
    } catch {
      intelProfiles = [];
    }

    // Index once: O(customers + orders + shipments + payments) instead of scanning them per customer (FX-23)
    const ordersByCustomer = new Map<string, typeof orders>();
    for (const o of orders) {
      const list = ordersByCustomer.get(o.customer_id);
      if (list) list.push(o);
      else ordersByCustomer.set(o.customer_id, [o]);
    }
    const returnedOrderIds = new Set(shipments.filter((s) => s.status === "RETURNED" || s.status === "FAILED").map((s) => s.order_id));
    const failedPaymentOrderIds = new Set(payments.filter((p) => p.status === "FAILED").map((p) => p.order_id));
    const lifecycleByCustomer = new Map(lifecycles.map((l) => [l.customer_id, l]));
    const intelByCustomer = new Map(intelProfiles.map((ip) => [ip.customer_id, ip]));

    const now = Date.now();

    return customers.map((c) => {
      const custOrders = ordersByCustomer.get(c.id) ?? [];
      const totalSpend = custOrders.reduce((sum, o) => sum + (o.grand_total || 0), 0);
      const orderCount = custOrders.length;
      const averageOrderValue = orderCount > 0 ? Math.round(totalSpend / orderCount) : 0;

      const timestamps = custOrders
        .map((o) => new Date(o.created_at).getTime())
        .filter((t) => !isNaN(t))
        .sort((a, b) => b - a);

      const lastPurchaseDaysAgo = timestamps.length > 0 ? Math.floor((now - timestamps[0]) / 86400000) : 999;
      const firstPurchaseDaysAgo =
        timestamps.length > 0 ? Math.floor((now - timestamps[timestamps.length - 1]) / 86400000) : 999;

      const purchasedProductIds: string[] = [];
      const purchasedCategories: string[] = [];
      for (const o of custOrders) {
        for (const item of o.items || []) {
          if (item.product_id) purchasedProductIds.push(item.product_id);
        }
      }

      const hasReturnedOrder = custOrders.some((o) => returnedOrderIds.has(o.id));
      const hasFailedPayment = custOrders.some((o) => failedPaymentOrderIds.has(o.id));

      const lifecycle = lifecycleByCustomer.get(c.id);
      const intel = intelByCustomer.get(c.id);

      return {
        customer: c,
        orderCount,
        totalSpend,
        averageOrderValue,
        lastPurchaseDaysAgo,
        firstPurchaseDaysAgo,
        lifecycleStage: lifecycle?.stage || (orderCount > 1 ? "REPEAT" : orderCount === 1 ? "FIRST_PURCHASE" : "NEW"),
        rfmSegment: intel?.rfm_segment,
        predictedLtvBdt: intel?.estimated_ltv_bdt || lifecycle?.predicted_ltv_12m_bdt || totalSpend * 1.5,
        churnRiskLevel: lastPurchaseDaysAgo > 60 ? "HIGH" : "LOW", // intelligence records have no churn_risk_level; this was always the fallback
        purchasedProductIds,
        purchasedCategories,
        hasReturnedOrder,
        hasFailedPayment,
        hasAbandonedCart: false,
      };
    });
  }

  /**
   * Creates a new audience
   */
  public createAudience(params: {
    tenantId: string;
    name: string;
    description: string;
    type: Audience["type"];
    ruleGroups: AudienceRuleGroup[];
    predictiveMetadata?: PredictiveSegmentMetadata;
    createdBy?: string;
  }): Audience {
    const { tenantId, name, description, type, ruleGroups, predictiveMetadata, createdBy } = params;

    const audience: Audience = {
      id: `aud_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      name,
      description,
      type,
      status: "ACTIVE",
      rule_groups: ruleGroups,
      predictive_metadata: predictiveMetadata,
      estimated_size: 0,
      last_evaluated_at: new Date().toISOString(),
      created_by: createdBy || "SYSTEM",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Calculate initial membership
    const evaluated = this.evaluateAudienceMembership(tenantId, audience);
    audience.estimated_size = evaluated.memberIds.length;

    db.insertAudience(audience);
    return audience;
  }

  /**
   * Evaluates audience membership against live customer records
   */
  public evaluateAudienceMembership(tenantId: string, audience: Audience): { memberIds: string[] } {
    const contexts = this.buildCustomerContexts(tenantId);
    const memberIds: string[] = [];

    for (const ctx of contexts) {
      let isMatch = true;

      if (audience.rule_groups && audience.rule_groups.length > 0) {
        // All rule groups must match (AND between groups)
        isMatch = audience.rule_groups.every((rg) => segmentEngineService.evaluateRuleGroup(ctx, rg));
      }

      // If predictive segment, enforce score threshold
      if (isMatch && audience.type === "PREDICTIVE" && audience.predictive_metadata) {
        const threshold = audience.predictive_metadata.score_threshold;
        const ltv = ctx.predictedLtvBdt || 0;
        if (ltv < threshold) {
          isMatch = false;
        }
      }

      if (isMatch) {
        memberIds.push(ctx.customer.id);
      }
    }

    return { memberIds };
  }

  /**
   * Creates an immutable snapshot of audience members for campaign execution
   */
  public createAudienceSnapshot(tenantId: string, audienceId: string, campaignId?: string): AudienceSnapshot {
    const audience = db.getAudienceById(tenantId, audienceId);
    if (!audience || audience.tenant_id !== tenantId) {
      throw new AppError("NOT_FOUND", `Audience not found: ${audienceId}`, 404);
    }

    const { memberIds } = this.evaluateAudienceMembership(tenantId, audience);

    const snapshot: AudienceSnapshot = {
      id: `snp_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      audience_id: audienceId,
      campaign_id: campaignId,
      member_count: memberIds.length,
      customer_ids: memberIds,
      snapshot_hash: `sha256_${Date.now()}_${memberIds.length}`,
      created_at: new Date().toISOString(),
    };

    db.insertAudienceSnapshot(snapshot);
    db.updateAudience(tenantId, audienceId, {
      estimated_size: memberIds.length,
      last_evaluated_at: new Date().toISOString(),
    });

    return snapshot;
  }

  /**
   * Lists all audiences for a tenant
   */
  public listAudiences(tenantId: string): Audience[] {
    return db.getAudiences(tenantId);
  }

  /**
   * Gets audience by ID
   */
  public getAudience(tenantId: string, id: string): Audience | undefined {
    const aud = db.getAudienceById(tenantId, id);
    if (!aud || aud.tenant_id !== tenantId) return undefined;
    return aud;
  }
}

export const audienceService = new AudienceService();
