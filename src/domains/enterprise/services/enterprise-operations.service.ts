/**
 * CommerceOS Phase 9: Enterprise Operations Service
 * Network-wide operational health monitoring, store status matrix, and incident rollups.
 */

import { db } from "@/infrastructure/db";
import { AnalyticsService } from "@/domains/analytics/analytics.service";
import { EnterpriseOverview, EnterpriseIncident } from "@/types/enterprise";

export class EnterpriseOperationsService {
  /**
   * Generates comprehensive enterprise operations command center overview
   */
  public getOverview(orgId: string, tenantId: string): EnterpriseOverview {
    const org = db.findOrganizationById(orgId) || {
      id: orgId,
      name: "Apex Holdings Commerce",
      slug: "apex-holdings",
      legal_name: "Apex Holdings Ltd",
      default_currency: "BDT",
      supported_currencies: ["BDT", "USD"],
      headquarters_country: "Bangladesh",
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const businessUnits = db.getBusinessUnits(orgId);
    const brands = db.getEnterpriseBrands(orgId);
    const stores = db.getEnterpriseStores(orgId);
    const incidents = db.getEnterpriseIncidents(orgId);
    const syncs = db.getIntegrationSyncs(orgId);
    const orders = db.getAllOrders(tenantId, { hydrate: true });
    const inventory = db.getInventory(tenantId);

    const totalRev = orders.reduce((sum, o) => sum + (o.grand_total || 0), 0);
    const stockoutCount = inventory.filter((i) => i.quantity_available <= 0).length;

    // Orders carry no store, so a store's revenue, orders and SLA can't be known. These were split by list position
    // (35%, 27%, 19%...), the third store was always DEGRADED and SLA was 96.5% minus 1.5 per position (FX-30).
    const healthMatrix = stores.map((s) => ({
      entity_id: s.id,
      entity_name: s.name,
      entity_type: "STORE" as const,
      status: "UNKNOWN" as const,
      revenue_bdt: null,
      order_count: null,
      stockout_count: null,
      fulfillment_sla_pct: null,
    }));

    const valid = orders.filter((o) => o.status !== "CANCELLED");
    const costs = AnalyticsService.unitCosts(tenantId);
    const validRev = valid.reduce((sum, o) => sum + (o.grand_total || 0), 0);
    const cogs = valid.reduce((sum, o) => sum + AnalyticsService.orderCogs(o, costs).total, 0);
    const budget = db.getEnterpriseAIBudget(orgId);

    return {
      organization: org,
      summary_metrics: {
        total_business_units: businessUnits.length,
        total_brands: brands.length,
        total_stores: stores.length,
        active_channels: db.getConnectedChannels(tenantId).filter((c) => c.status === "ACTIVE").length,
        consolidated_revenue_bdt: totalRev,
        consolidated_orders: orders.length,
        blended_gross_margin_pct: validRev > 0 ? Math.round(((validRev - cogs) / validRev) * 1000) / 10 : null,
        network_stockout_risk_items: stockoutCount,
        active_incidents_count: incidents.filter((i) => i.status !== "RESOLVED" && i.status !== "POSTMORTEM").length,
        data_quality_open_issues: db.getDataQualityIssues(orgId).filter((i) => i.status === "OPEN" || i.status === "IN_REVIEW").length,
        data_quality_health_pct: null,
        connected_integrations_count: db.getIntegrationInstallations(orgId).length,
        ai_budget_used_pct:
          budget && budget.monthly_budget_usd > 0
            ? Math.round((budget.monthly_spent_usd / budget.monthly_budget_usd) * 1000) / 10
            : null,
      },
      entity_health_matrix: healthMatrix,
      recent_incidents: incidents.slice(0, 5),
      recent_syncs: syncs.slice(0, 5),
    };
  }
}

export const enterpriseOperationsService = new EnterpriseOperationsService();
