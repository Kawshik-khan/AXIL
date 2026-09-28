/**
 * CommerceOS Phase 10: Unified Commerce Context Service
 * Aggregates real-time state from all domains into one UnifiedCommerceContext.
 */

import { db } from "@/infrastructure/db";
import { UnifiedCommerceContext } from "@/types/autonomous";

export class UnifiedContextService {
  /**
   * Build a unified context snapshot from all commerce domains.
   */
  buildContext(tenantId: string): UnifiedCommerceContext {
    const now = new Date().toISOString();
    const orders = db.data.orders.filter((o) => o.tenant_id === tenantId);
    const customers = db.data.customers.filter((c) => c.tenant_id === tenantId);
    const products = db.data.products.filter((p) => p.tenant_id === tenantId);
    const inventory = db.data.inventory_items.filter((i) => i.tenant_id === tenantId);
    const campaigns = db.data.campaigns?.filter((c) => c.tenant_id === tenantId) || [];
    const experiments = db.data.experiments?.filter((e) => e.tenant_id === tenantId) || [];
    const anomalies = db.data.anomalies?.filter((a) => a.tenant_id === tenantId) || [];
    const opportunities = db.data.opportunities?.filter((o) => o.tenant_id === tenantId) || [];
    const risks = db.data.risks?.filter((r) => r.tenant_id === tenantId) || [];
    const exceptions = db.data.operational_exceptions?.filter((e) => e.tenant_id === tenantId) || [];
    // Only this workspace's organizations: these counted every tenant's stores, brands, integrations and incidents
    const orgIds = new Set(db.getOrganizations().filter((o) => o.tenant_id === tenantId).map((o) => o.id));
    const stores = db.data.enterprise_stores?.filter((s) => orgIds.has(s.organization_id)) || [];
    const brands = db.data.enterprise_brands?.filter((b) => orgIds.has(b.organization_id)) || [];
    const integrations = (db.data.integration_installations || []).filter((i) => orgIds.has(i.organization_id));
    const incidents = (db.data.enterprise_incidents || []).filter((i) => orgIds.has(i.organization_id));
    const approvalRequests = db.data.approval_requests?.filter((a) => a.tenant_id === tenantId) || [];
    const agentRuns = db.data.agent_runs?.filter((r) => r.tenant_id === tenantId) || [];
    const workflows = db.data.autonomous_workflow_runs?.filter((w) => w.tenant_id === tenantId) || [];
    const health = db.data.platform_health_records.find((h) => h.tenant_id === tenantId);

    const totalRevenue = orders.reduce((sum, o) => sum + (o.grand_total || 0), 0);
    const avgOrderValue = orders.length > 0 ? totalRevenue / orders.length : 0;
    const lowStockItems = inventory.filter((i) => i.quantity_available <= (i.reorder_point || 5));

    const detectedOpportunities: string[] = [];
    const detectedRisks: string[] = [];

    if (lowStockItems.length > products.length * 0.15) {
      detectedRisks.push(`${lowStockItems.length} SKUs at stockout risk (>${Math.round(lowStockItems.length / products.length * 100)}% of catalog)`);
    }
    if (opportunities.length > 0) {
      detectedOpportunities.push(`${opportunities.length} active growth opportunities identified`);
    }
    const unexplainedAnomalies = anomalies.filter((a) => a.explanation_status === "UNEXPLAINED");
    if (unexplainedAnomalies.length > 0) {
      detectedRisks.push(`${unexplainedAnomalies.length} unexplained anomalies require attention`);
    }

    const recentAgentRuns = agentRuns.filter((r) => {
      const runTime = new Date(r.created_at).getTime();
      return Date.now() - runTime < 86400000; // 24h
    });
    const successfulRuns = recentAgentRuns.filter((r) => r.status === "COMPLETED");

    // Repeat purchase rate from orders: buying customers with 2+ orders (was a literal 28.5)
    const ordersPerCustomer = new Map<string, number>();
    for (const o of orders) if (o.status !== "CANCELLED") ordersPerCustomer.set(o.customer_id, (ordersPerCustomer.get(o.customer_id) ?? 0) + 1);
    const buyers = ordersPerCustomer.size;
    const repeaters = [...ordersPerCustomer.values()].filter((n) => n >= 2).length;

    return {
      tenant_id: tenantId,
      generated_at: now,
      commerce: {
        total_revenue_bdt: totalRevenue,
        total_orders: orders.length,
        average_order_value_bdt: Math.round(avgOrderValue * 100) / 100,
        active_customers: customers.filter((c) => c.status === "ACTIVE").length,
        conversion_rate: null, // no visit data exists (was a literal 3.2) (FX-30)
      },
      inventory: {
        total_skus: products.length,
        stockout_risk_count: lowStockItems.length,
        overstock_count: inventory.filter((i) => i.quantity_available > (i.reorder_point || 5) * 5).length,
        inventory_turnover: null, // not computed (was a literal 4.2)
        pending_transfers: 0,
      },
      operations: {
        system_mode: health?.autonomous_mode || "COPILOT",
        overall_health_score: health?.dimensions?.OPERATIONS?.score || 0,
        open_exceptions: exceptions.filter((e) => e.status !== "RESOLVED").length,
        sla_compliance_percent: null, // SLAs aren't tracked (was a literal 94)
        active_workflows: workflows.filter((w) => !["COMPLETED", "FAILED", "ROLLED_BACK"].includes(w.status)).length,
      },
      growth: {
        active_campaigns: campaigns.filter((c) => c.status === "RUNNING").length,
        active_journeys: db.getJourneys(tenantId).filter((j) => j.status === "ACTIVE").length,
        active_experiments: experiments.filter((e) => e.status === "RUNNING").length,
        customer_acquisition_cost_bdt: null, // no acquisition spend recorded (was a literal 350)
        repeat_purchase_rate: buyers > 0 ? Math.round((repeaters / buyers) * 1000) / 10 : null,
      },
      intelligence: {
        active_forecasts: db.data.forecast_runs?.filter((f) => f.tenant_id === tenantId).length || 0,
        open_anomalies: unexplainedAnomalies.length,
        pending_recommendations: db.data.recommendations?.filter((r) => r.tenant_id === tenantId && r.status === "PROPOSED").length || 0,
        active_opportunities: opportunities.length,
        active_risks: risks.length,
      },
      enterprise: {
        total_stores: stores.length,
        total_brands: brands.length,
        healthy_integrations: integrations.filter((i) => i.status === "CONNECTED" || (i as any).status === "HEALTHY").length,
        degraded_integrations: integrations.filter((i) => (i as any).status === "DEGRADED" || i.status === "FAILED").length,
        pending_incidents: incidents.filter((i) => i.status !== "RESOLVED" && i.status !== "POSTMORTEM").length,
      },
      agents: {
        active_agents: db.data.agents?.filter((a) => a.tenant_id === tenantId && a.status === "ACTIVE").length || 0,
        running_tasks: db.data.tasks?.filter((t) => t.tenant_id === tenantId && t.status === "RUNNING").length || 0,
        pending_approvals: approvalRequests.filter((a) => a.status === "PENDING").length,
        success_rate_24h: recentAgentRuns.length > 0 ? (successfulRuns.length / recentAgentRuns.length) * 100 : 100,
        escalations_24h: recentAgentRuns.filter((r) => r.status === "ESCALATED").length,
      },
      detected_opportunities: detectedOpportunities,
      detected_risks: detectedRisks,
    };
  }

  /**
   * Detect opportunities from the unified context.
   */
  detectOpportunities(context: UnifiedCommerceContext): string[] {
    const opportunities: string[] = [...context.detected_opportunities];
    if (context.growth.repeat_purchase_rate !== null && context.growth.repeat_purchase_rate < 30) {
      opportunities.push("Repeat purchase rate below 30% — retention campaign opportunity");
    }
    if (context.commerce.conversion_rate !== null && context.commerce.conversion_rate < 3) {
      opportunities.push("Conversion rate below 3% — checkout optimization opportunity");
    }
    return opportunities;
  }

  /**
   * Detect risks from the unified context.
   */
  detectRisks(context: UnifiedCommerceContext): string[] {
    const risks: string[] = [...context.detected_risks];
    if (context.operations.overall_health_score < 70) {
      risks.push("Operations health below 70% — immediate attention required");
    }
    if (context.agents.success_rate_24h < 80) {
      risks.push("Agent success rate below 80% in last 24h");
    }
    return risks;
  }
}
