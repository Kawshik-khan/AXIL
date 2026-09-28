/**
 * CommerceOS Phase 9: Semantic Metrics Layer & Governed KPI Framework
 * Centralized definition, calculation, and natural-language resolution of enterprise KPIs.
 */

import { db } from "@/infrastructure/db";
import { enterpriseDataAccessService } from "./enterprise-data-access.service";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { AnalyticsService } from "@/domains/analytics/analytics.service";
import {
  MetricDefinition,
  SemanticMetricQuery,
  EnterpriseUserRecord,
  SemanticMetricResult,
  MetricTimeGrain,
} from "@/types/enterprise";

export class SemanticMetricsService {
  /**
   * The organization's metric definitions: stored ones, or the standard set built in memory when none are stored yet.
   * Read-only (FX-21).
   */
  public listMetrics(orgId: string): MetricDefinition[] {
    const stored = db.getSemanticMetrics(orgId);
    return stored.length > 0 ? stored : this.standardMetricDefinitions(orgId);
  }

  /**
   * Seeds standard enterprise metric definitions for an organization
   */
  public seedStandardMetrics(orgId: string): MetricDefinition[] {
    const results: MetricDefinition[] = [];
    for (const m of this.standardMetricDefinitions(orgId)) {
      const existing = db.findSemanticMetricByKey(orgId, m.key);
      results.push(existing ?? db.createSemanticMetric(m));
    }
    return results;
  }

  /** Pure: the standard definitions with deterministic ids `metric_${key}_${orgId}`. */
  private standardMetricDefinitions(orgId: string): MetricDefinition[] {
    const now = db.findOrganizationById(orgId)?.created_at ?? "1970-01-01T00:00:00.000Z"; // stable across reads
    const standardMetrics: Array<Omit<MetricDefinition, "id" | "created_at" | "updated_at">> = [
      {
        organization_id: orgId,
        key: "gross_revenue",
        name: "Gross Revenue",
        category: "FINANCIAL",
        description: "Total order value before deductions, returns, or refunds",
        formula: "SUM(order.total_amount_bdt)",
        unit: "BDT",
        supported_dimensions: ["STORE", "BRAND", "CHANNEL", "REGION"],
        supported_time_grains: ["DAY", "WEEK", "MONTH", "QUARTER", "YEAR"],
        data_quality_status: "VERIFIED",
        owner: "Finance & Analytics Team",
        version: "1.0.0",
      },
      {
        organization_id: orgId,
        key: "net_revenue",
        name: "Net Revenue",
        category: "FINANCIAL",
        description: "Gross revenue minus discounts, cancellations, and processed refunds",
        formula: "Gross Revenue - Refunds - Discounts",
        unit: "BDT",
        supported_dimensions: ["STORE", "BRAND", "REGION"],
        supported_time_grains: ["DAY", "WEEK", "MONTH", "QUARTER", "YEAR"],
        data_quality_status: "VERIFIED",
        owner: "Finance Team",
        version: "1.0.0",
      },
      {
        organization_id: orgId,
        key: "gross_margin_pct",
        name: "Gross Margin %",
        category: "FINANCIAL",
        description: "Percentage difference between net selling price and product cost price",
        formula: "((Net Revenue - COGS) / Net Revenue) * 100",
        unit: "PERCENT",
        supported_dimensions: ["BRAND", "STORE", "CATEGORY"],
        supported_time_grains: ["DAY", "WEEK", "MONTH"],
        data_quality_status: "VERIFIED",
        owner: "Pricing & Finance Team",
        version: "1.0.0",
      },
      {
        organization_id: orgId,
        key: "average_order_value",
        name: "Average Order Value (AOV)",
        category: "COMMERCE",
        description: "Average revenue generated per completed order",
        formula: "Total Order Revenue / Total Completed Orders",
        unit: "BDT",
        supported_dimensions: ["STORE", "BRAND", "CHANNEL"],
        supported_time_grains: ["DAY", "WEEK", "MONTH"],
        data_quality_status: "VERIFIED",
        owner: "Growth Team",
        version: "1.0.0",
      },
      {
        organization_id: orgId,
        key: "order_count",
        name: "Total Orders",
        category: "COMMERCE",
        description: "Total non-cancelled order placements",
        formula: "COUNT(orders)",
        unit: "COUNT",
        supported_dimensions: ["STORE", "BRAND", "CHANNEL", "REGION"],
        supported_time_grains: ["HOUR", "DAY", "WEEK", "MONTH"],
        data_quality_status: "VERIFIED",
        owner: "Operations Team",
        version: "1.0.0",
      },
      {
        organization_id: orgId,
        key: "delivery_sla_pct",
        name: "Delivery SLA Adherence %",
        category: "FULFILLMENT",
        description: "Percentage of shipments delivered within guaranteed courier SLA window",
        formula: "(On-Time Deliveries / Total Completed Deliveries) * 100",
        unit: "PERCENT",
        supported_dimensions: ["STORE", "COURIER", "REGION"],
        supported_time_grains: ["DAY", "WEEK", "MONTH"],
        data_quality_status: "VERIFIED",
        owner: "Logistics Team",
        version: "1.0.0",
      },
      {
        organization_id: orgId,
        key: "stockout_rate_pct",
        name: "Stockout Rate %",
        category: "INVENTORY",
        description: "Proportion of active catalog SKUs with zero available inventory",
        formula: "(Zero Stock SKUs / Active SKUs) * 100",
        unit: "PERCENT",
        supported_dimensions: ["STORE", "BRAND", "WAREHOUSE"],
        supported_time_grains: ["DAY", "WEEK"],
        data_quality_status: "VERIFIED",
        owner: "Inventory Operations",
        version: "1.0.0",
      },
    ];
    return standardMetrics.map((m) => ({ ...m, id: `metric_${m.key}_${orgId}`, created_at: now, updated_at: now }));
  }

  /**
   * Evaluates a semantic metric for an organization, seeding standard definitions if needed (explicit write path)
   */
  public evaluateMetric(orgId: string, query: SemanticMetricQuery, tenantId: string, caller?: EnterpriseUserRecord): SemanticMetricResult {
    this.seedStandardMetrics(orgId);
    return this.queryMetric(orgId, query, tenantId, caller);
  }

  /**
   * Calculates a governed metric from the workspace's data.
   * - Definitions come from this organization (they used to be read from the shared `org_default`, N12).
   * - Organization values are workspace-wide, so they need organization-wide enterprise scope; a store, brand or
   *   business-unit value must be in the caller's scope and is `null` (NOT_MEASURED): orders carry no store (N13).
   * - No invented values: margin was a literal 32.5%, delivery SLA fell back to 94.2% and unknown keys returned 100
   *   (FX-30). Unknown keys are an error; values without data are `null`.
   * `caller` is omitted only by system workflows, which act organization-wide.
   */
  public queryMetric(orgId: string, query: SemanticMetricQuery, tenantId: string, caller?: EnterpriseUserRecord): SemanticMetricResult {
    // Stored definition, else the standard one built in memory: querying never writes (FX-21)
    const metric =
      db.findSemanticMetricByKey(orgId, query.metric_key) ??
      this.standardMetricDefinitions(orgId).find((s) => s.key === query.metric_key);
    if (!metric) {
      throw new NotFoundError("Semantic metric", query.metric_key);
    }

    const entityType = query.entity_type || "ORGANIZATION";
    const base = {
      metric_key: metric.key,
      metric_name: metric.name,
      unit: metric.unit,
      currency: metric.unit === "BDT" ? "BDT" : undefined,
      time_grain: query.time_grain || "MONTH",
      dimensions_applied: query.dimensions || {},
      formula_used: metric.formula,
      calculated_at: new Date().toISOString(),
    } as const;

    if (entityType !== "ORGANIZATION") {
      const entityId = query.entity_id ?? "";
      if (caller && !enterpriseDataAccessService.isEntityAuthorized(caller, entityType as "STORE" | "BRAND" | "BUSINESS_UNIT", entityId)) {
        throw new ForbiddenError("That entity is outside your enterprise scope");
      }
      return { ...base, value: null, sample_count: 0, data_quality_status: "NOT_MEASURED" };
    }
    if (caller && !caller.assigned_scope.all_access) {
      throw new ForbiddenError("Organization-wide metrics need organization-wide enterprise scope");
    }

    const orders = db.getAllOrders(tenantId, { hydrate: true });
    const valid = orders.filter((o) => o.status !== "CANCELLED");
    let value: number | null = null;
    let sampleCount = 0;

    switch (query.metric_key) {
      case "gross_revenue": {
        value = valid.reduce((sum, o) => sum + (o.grand_total || 0), 0);
        sampleCount = valid.length;
        break;
      }
      case "net_revenue": {
        const completed = orders.filter((o) => o.status === "DELIVERED" || o.status === "CONFIRMED");
        value = completed.reduce((sum, o) => sum + (o.grand_total || 0), 0);
        sampleCount = completed.length;
        break;
      }
      case "gross_margin_pct": {
        const costs = AnalyticsService.unitCosts(tenantId);
        const revenue = valid.reduce((sum, o) => sum + (o.grand_total || 0), 0);
        const cogs = valid.reduce((sum, o) => sum + AnalyticsService.orderCogs(o, costs).total, 0);
        value = revenue > 0 ? Math.round(((revenue - cogs) / revenue) * 1000) / 10 : null;
        sampleCount = valid.length;
        break;
      }
      case "average_order_value": {
        const total = valid.reduce((sum, o) => sum + (o.grand_total || 0), 0);
        value = valid.length > 0 ? Math.round(total / valid.length) : null;
        sampleCount = valid.length;
        break;
      }
      case "order_count": {
        value = valid.length;
        sampleCount = valid.length;
        break;
      }
      case "delivery_sla_pct": {
        // No promised delivery dates are stored, so this is the delivered share of finished shipments
        const finished = db.getShipments(tenantId).filter((s) => ["DELIVERED", "FAILED", "RETURNED"].includes(s.status));
        const delivered = finished.filter((s) => s.status === "DELIVERED").length;
        value = finished.length > 0 ? Number(((delivered / finished.length) * 100).toFixed(1)) : null;
        sampleCount = finished.length;
        break;
      }
      case "stockout_rate_pct": {
        const inventory = db.getInventory(tenantId);
        const outOfStock = inventory.filter((i) => i.quantity_available <= 0);
        value = inventory.length > 0 ? Number(((outOfStock.length / inventory.length) * 100).toFixed(1)) : null;
        sampleCount = inventory.length;
        break;
      }
      default:
        // A stored definition without a calculation here: not measured, never a made-up number
        value = null;
    }

    return {
      ...base,
      value,
      sample_count: sampleCount,
      data_quality_status: value === null ? "NOT_MEASURED" : metric.data_quality_status,
    };
  }

  /**
   * Resolves a natural-language question into a governed semantic metric query
   */
  public resolveNaturalLanguageMetric(queryText: string): string | null {
    const text = queryText.toLowerCase();
    if (text.includes("revenue") || text.includes("sales") || text.includes("income")) {
      return text.includes("net") ? "net_revenue" : "gross_revenue";
    }
    if (text.includes("margin") || text.includes("profit")) {
      return "gross_margin_pct";
    }
    if (text.includes("aov") || text.includes("average order")) {
      return "average_order_value";
    }
    if (text.includes("order count") || text.includes("total orders")) {
      return "order_count";
    }
    if (text.includes("sla") || text.includes("delivery success") || text.includes("on time")) {
      return "delivery_sla_pct";
    }
    if (text.includes("stockout") || text.includes("out of stock")) {
      return "stockout_rate_pct";
    }
    return null;
  }
}

export const semanticMetricsService = new SemanticMetricsService();
