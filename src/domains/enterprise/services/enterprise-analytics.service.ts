/**
 * CommerceOS Phase 9: Enterprise Analytics & Cross-Entity BI Service
 * Multi-store, multi-brand, business unit, and regional analytics with drill-down and roll-up.
 *
 * Orders carry no store, brand or business unit, so per-entity figures can't be measured yet. This used to split the
 * workspace's revenue evenly across stores (at least one order each), give stores an SLA of 95.5% minus 1.2 per
 * position, and report fixed channel (45/35/12/8%) and regional (65/20/10/5%) shares (FX-30). Now:
 * - entities list the stores in the caller's scope (N11) with null figures;
 * - organization totals, channel and regional sums are real, from the workspace's orders, but only for callers with
 *   organization-wide scope: a member scoped to some stores can't be shown workspace-wide revenue, and it can't be
 *   narrowed to their stores, so those figures are null for them.
 */

import { db } from "@/infrastructure/db";
import { enterpriseDataAccessService } from "./enterprise-data-access.service";
import { EnterpriseUserRecord } from "@/types/enterprise";
import { channelOfOrder } from "@/lib/sales-channel";

export interface EntityAnalyticsSummary {
  entity_id: string;
  entity_name: string;
  entity_type: "STORE" | "BRAND" | "BUSINESS_UNIT";
  revenue_bdt: number | null;
  orders_count: number | null;
  aov_bdt: number | null;
  active_skus_count: number | null;
  delivery_sla_pct: number | null;
}

export interface ConsolidatedEnterpriseAnalytics {
  organization_id: string;
  /** Null for callers without organization-wide scope. */
  total_revenue_bdt: number | null;
  total_orders_count: number | null;
  blended_aov_bdt: number | null;
  entities: EntityAnalyticsSummary[];
  /** NOT_MEASURED until orders are attributed to stores. */
  entity_data_status: "MEASURED" | "NOT_MEASURED";
  /** Revenue by sales channel (BDT); empty for callers without organization-wide scope. */
  channel_distribution: Record<string, number>;
  /** Revenue by delivery division (BDT); orders without one count as "Unknown". */
  regional_distribution: Record<string, number>;
  scope: "ORGANIZATION" | "PARTIAL";
  generated_at: string;
}

export class EnterpriseAnalyticsService {
  /**
   * Consolidated analytics for the caller's scope
   */
  public getConsolidatedAnalytics(
    orgId: string,
    caller: EnterpriseUserRecord,
    tenantId: string
  ): ConsolidatedEnterpriseAnalytics {
    const authorizedStores = enterpriseDataAccessService.getAuthorizedStores(caller);
    const entities: EntityAnalyticsSummary[] = authorizedStores.map((store) => ({
      entity_id: store.id,
      entity_name: store.name,
      entity_type: "STORE",
      revenue_bdt: null,
      orders_count: null,
      aov_bdt: null,
      active_skus_count: null,
      delivery_sla_pct: null,
    }));

    const base = {
      organization_id: orgId,
      entities,
      entity_data_status: "NOT_MEASURED" as const,
      generated_at: new Date().toISOString(),
    };

    if (!caller.assigned_scope.all_access) {
      return {
        ...base,
        total_revenue_bdt: null,
        total_orders_count: null,
        blended_aov_bdt: null,
        channel_distribution: {},
        regional_distribution: {},
        scope: "PARTIAL",
      };
    }

    const orders = db.getAllOrders(tenantId).filter((o) => o.status !== "CANCELLED");
    const totalRevenue = orders.reduce((sum, o) => sum + (o.grand_total || 0), 0);
    const channelDist: Record<string, number> = {};
    const regionalDist: Record<string, number> = {};
    for (const o of orders) {
      const channel = channelOfOrder(o);
      channelDist[channel] = (channelDist[channel] ?? 0) + (o.grand_total || 0);
      const region = o.shipping_address_snapshot?.division?.trim() || "Unknown";
      regionalDist[region] = (regionalDist[region] ?? 0) + (o.grand_total || 0);
    }

    return {
      ...base,
      total_revenue_bdt: totalRevenue,
      total_orders_count: orders.length,
      blended_aov_bdt: orders.length > 0 ? Math.round(totalRevenue / orders.length) : null,
      channel_distribution: channelDist,
      regional_distribution: regionalDist,
      scope: "ORGANIZATION",
    };
  }
}

export const enterpriseAnalyticsService = new EnterpriseAnalyticsService();
