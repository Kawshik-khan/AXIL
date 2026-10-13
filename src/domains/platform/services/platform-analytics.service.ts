import { db } from "@/infrastructure/db";
import { PlatformContext } from "@/lib/context";
import { PlatformAuthorizationService } from "./platform-authorization.service";
import { PlatformSettingsService } from "./platform-settings.service";
import { mrrContribution } from "../plan-pricing";
import { productRepository } from "@/domains/catalog/product.repository";
import { orderRepository } from "@/domains/orders/order.repository";

export interface ActivationFunnel {
  /** Workspaces counted (archived ones excluded). */
  workspaces: number;
  with_product: number;
  with_order: number;
  paying: number;
  /** Signups per ISO week (Monday start, UTC), oldest first, with how many of each cohort have placed an order. */
  weekly_cohorts: Array<{ week_start: string; signups: number; with_order: number }>;
}

function weekStart(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().substring(0, 10);
}

/** SIMULATED: the integration isn't built, so nothing is sent to the provider (FX-31). */
export type ProviderRailStatus = "HEALTHY" | "DEGRADED" | "DOWN" | "SIMULATED";

export interface PlatformOverviewMetrics {
  tenants: {
    total: number;
    active: number;
    trial: number;
    suspended: number;
    archived: number;
  };
  financials: {
    mrr_bdt: number;
    arr_bdt: number;
    active_subscriptions_count: number;
    arpu_bdt: number;
    currency: string;
  };
  commerce_velocity: {
    total_gmv_bdt: number;
    total_orders_count: number;
    avg_order_value_bdt: number;
    /** null without orders */
    cod_percentage: number | null;
    digital_payment_percentage: number | null;
  };
  ai_fleet: {
    total_conversations: number;
    total_tokens: number;
    estimated_cost_usd: number;
    estimated_cost_bdt: number;
    /** null without agent runs */
    autonomous_resolution_rate: number | null;
  };
  automation_health: {
    total_automations: number;
    active_automations: number;
    total_executions: number;
    failed_executions: number;
    /** null without executions */
    success_rate_percent: number | null;
    failure_rate_percent: number;
    dlq_items_count: number;
  };
  infrastructure: {
    n8n_instances_count: number;
    healthy_n8n_instances: number;
    open_incidents_count: number;
    kill_switch_active: boolean;
  };
  provider_health: {
    steadfast_status: ProviderRailStatus;
    pathao_status: ProviderRailStatus;
    bkash_status: ProviderRailStatus;
    meta_status: ProviderRailStatus;
  };
  security: {
    platform_operators_count: number;
    active_impersonation_sessions: number;
    recent_security_events: number;
    /** Share of active operators with MFA enabled; null without operators. */
    mfa_enforced_percent: number | null;
  };
}

export class PlatformAnalyticsService {
  /**
   * Calculates platform overview metrics strictly from authoritative storage.
   * Invariant: Never fabricates metrics or displays fake data.
   */
  public static getPlatformOverview(context: PlatformContext): PlatformOverviewMetrics {
    PlatformAuthorizationService.assertCan(context, "platform.read");

    const tenants = db.getTenants();
    const subscriptions = db.getSubscriptions();
    const planVersions = db.getPlanVersions();

    // Tenant counts
    const activeTenants = tenants.filter((t) => t.status === "ACTIVE").length;
    const trialTenants = tenants.filter((t) => t.status === "TRIAL").length;
    const suspendedTenants = tenants.filter((t) => t.status === "SUSPENDED").length;
    const archivedTenants = tenants.filter((t) => t.status === "ARCHIVED").length;

    // Financials: aggregate MRR from active subscriptions
    let totalMrrBdt = 0;
    let activeSubsCount = 0;
    for (const sub of subscriptions) {
      if (sub.status === "ACTIVE") {
        activeSubsCount++;
        const version = planVersions.find((v) => v.id === sub.plan_version_id);
        if (version) {
          // Annual subscriptions count annual price / 12 (SA-11)
          totalMrrBdt += mrrContribution(sub, version);
        }
      }
    }
    totalMrrBdt = Math.round(totalMrrBdt);
    const arrBdt = totalMrrBdt * 12;
    const arpuBdt = activeSubsCount > 0 ? Math.round(totalMrrBdt / activeSubsCount) : 0;

    // Commerce Velocity: aggregated across all tenant stores
    const velocity = this.getCommerceVelocitySync();

    // AI & Agentic Fleet Telemetry
    const conversations = db.data.conversations || [];
    const aiUsage = db.data.ai_usage || [];
    const agentRuns = db.data.agent_runs || [];
    const totalTokens = aiUsage.reduce((sum, u) => sum + (u.total_tokens || 0), 0);
    const estCostUsd = aiUsage.reduce((sum, u) => sum + (u.estimated_cost_usd || 0), 0);
    // A BDT cost recorded at run time wins; otherwise convert USD at the registered rate (finance.usd_to_bdt_rate)
    const usdToBdt = PlatformSettingsService.getEffectiveSetting<number>("finance.usd_to_bdt_rate");
    const estCostBdt = aiUsage.reduce(
      (sum, u) => sum + (u.estimated_cost_bdt || (u.estimated_cost_usd ? u.estimated_cost_usd * usdToBdt : 0)),
      0
    );
    const completedRuns = agentRuns.filter((r) => r.status === "COMPLETED").length;
    const autoResolutionRate =
      agentRuns.length > 0 ? Math.round((completedRuns / agentRuns.length) * 1000) / 10 : null;

    // Automations telemetry
    const automations = db.data.automations || [];
    const activeAutomations = automations.filter((a) => a.status === "ACTIVE").length;
    const executions = db.data.automation_executions || [];
    const failedExecutions = executions.filter(
      (e) => e.status === "FAILED" || e.status === "DEAD_LETTERED"
    ).length;
    const dlqItems = db.data.automation_dead_letters || [];
    const failureRate = executions.length > 0 ? (failedExecutions / executions.length) * 100 : 0;
    const successRate = executions.length > 0 ? Math.round((100 - failureRate) * 10) / 10 : null;

    // Infrastructure & incidents
    const n8nInstances = db.data.n8n_instances || [];
    const healthyN8n = n8nInstances.filter((n) => n.health_status === "HEALTHY").length;
    const incidents = db.getPlatformIncidents();
    const openIncidents = incidents.filter((i) => i.status !== "RESOLVED" && i.status !== "CLOSED").length;
    const killSwitches = db.getPlatformKillSwitches();
    const isKillSwitchActive = killSwitches.some((k) => k.is_active);

    // No adapter talks to these providers yet (FX-31): report SIMULATED, never an invented HEALTHY/uptime.
    const providerHealth = {
      steadfast_status: "SIMULATED" as const,
      pathao_status: "SIMULATED" as const,
      bkash_status: "SIMULATED" as const,
      meta_status: "SIMULATED" as const,
    };

    // Security
    const platformMemberships = db.getPlatformMemberships();
    const activeImpersonations = db
      .getImpersonationSessions()
      .filter((s) => !s.revoked_at && new Date(s.expires_at) > new Date()).length;
    const securityEvents = db.getPlatformSecurityEvents(100);

    return {
      tenants: {
        total: tenants.length,
        active: activeTenants,
        trial: trialTenants,
        suspended: suspendedTenants,
        archived: archivedTenants,
      },
      financials: {
        mrr_bdt: totalMrrBdt,
        arr_bdt: arrBdt,
        active_subscriptions_count: activeSubsCount,
        arpu_bdt: arpuBdt,
        currency: "BDT",
      },
      commerce_velocity: velocity,
      ai_fleet: {
        total_conversations: conversations.length,
        total_tokens: totalTokens,
        estimated_cost_usd: estCostUsd,
        estimated_cost_bdt: estCostBdt,
        autonomous_resolution_rate: autoResolutionRate,
      },
      automation_health: {
        total_automations: automations.length,
        active_automations: activeAutomations,
        total_executions: executions.length,
        failed_executions: failedExecutions,
        success_rate_percent: successRate,
        failure_rate_percent: Math.round(failureRate * 10) / 10,
        dlq_items_count: dlqItems.length,
      },
      infrastructure: {
        n8n_instances_count: n8nInstances.length,
        healthy_n8n_instances: healthyN8n,
        open_incidents_count: openIncidents,
        kill_switch_active: isKillSwitchActive,
      },
      provider_health: providerHealth,
      security: {
        platform_operators_count: platformMemberships.length,
        active_impersonation_sessions: activeImpersonations,
        recent_security_events: securityEvents.length,
        mfa_enforced_percent: (() => {
          const active = platformMemberships.filter((m) => m.is_active);
          return active.length > 0 ? Math.round((active.filter((m) => m.mfa_enabled).length / active.length) * 100) : null;
        })(), // was a literal 100
      },
    };
  }

  public static getCommerceVelocitySync(): {
    total_gmv_bdt: number;
    total_orders_count: number;
    avg_order_value_bdt: number;
    cod_percentage: number | null;
    digital_payment_percentage: number | null;
  } {
    let orders: any[] = [];
    try {
      if (db.isCollectionHydrated?.("orders") !== false) {
        orders = db.data.orders || [];
      }
    } catch {
      orders = [];
    }
    const validOrders = orders.filter((o) => o.status !== "CANCELLED");
    const totalGmvBdt = validOrders.reduce((acc, o) => acc + (o.grand_total || 0), 0);
    const totalOrdersCount = validOrders.length;
    const avgOrderValue = totalOrdersCount > 0 ? Math.round(totalGmvBdt / totalOrdersCount) : 0;
    const codCount = validOrders.filter((o) => o.payment_method === "COD").length;
    const codPercentage = totalOrdersCount > 0 ? Math.round((codCount / totalOrdersCount) * 100) : null;
    const digitalPaymentPercentage = codPercentage === null ? null : 100 - codPercentage;

    return {
      total_gmv_bdt: totalGmvBdt,
      total_orders_count: totalOrdersCount,
      avg_order_value_bdt: avgOrderValue,
      cod_percentage: codPercentage,
      digital_payment_percentage: digitalPaymentPercentage,
    };
  }

  public static async getCommerceVelocityAsync(): Promise<{
    total_gmv_bdt: number;
    total_orders_count: number;
    avg_order_value_bdt: number;
    cod_percentage: number | null;
    digital_payment_percentage: number | null;
  }> {
    const client = db.isCollectionHydrated("orders") ? null : db.getSqlClient();
    if (client) {
      const res = await client.query<{
        total_orders: string;
        total_gmv: string;
        cod_orders: string;
      }>(
        `SELECT
           count(*)::text AS total_orders,
           coalesce(sum(grand_total), 0)::text AS total_gmv,
           count(*) FILTER (WHERE data->>'payment_method' = 'COD')::text AS cod_orders
         FROM commerceos.orders
         WHERE status != 'CANCELLED'`
      );
      const row = res.rows[0];
      const totalOrdersCount = Number(row?.total_orders ?? 0);
      const totalGmvBdt = Number(row?.total_gmv ?? 0);
      const avgOrderValue = totalOrdersCount > 0 ? Math.round(totalGmvBdt / totalOrdersCount) : 0;
      const codCount = Number(row?.cod_orders ?? 0);
      const codPercentage = totalOrdersCount > 0 ? Math.round((codCount / totalOrdersCount) * 100) : null;
      const digitalPaymentPercentage = codPercentage === null ? null : 100 - codPercentage;

      return {
        total_gmv_bdt: totalGmvBdt,
        total_orders_count: totalOrdersCount,
        avg_order_value_bdt: avgOrderValue,
        cod_percentage: codPercentage,
        digital_payment_percentage: digitalPaymentPercentage,
      };
    }

    return this.getCommerceVelocitySync();
  }

  public static async getPlatformOverviewAsync(context: PlatformContext): Promise<PlatformOverviewMetrics> {
    const overview = this.getPlatformOverview(context);
    overview.commerce_velocity = await this.getCommerceVelocityAsync();
    return overview;
  }

  /**
   * Activation funnel and weekly signup cohorts from every workspace (analytics read every row; nothing is stored).
   * Paying = an ACTIVE subscription whose plan version contributes more than 0 to MRR.
   */
  public static async getActivationFunnel(context: PlatformContext, weeks = 12): Promise<ActivationFunnel> {
    PlatformAuthorizationService.assertCan(context, "analytics.platform.read");
    const tenants = db.getTenants().filter((t) => t.status !== "ARCHIVED");
    const versions = db.getPlanVersions();
    let withProduct = 0;
    let withOrder = 0;
    let paying = 0;
    const ordered = new Set<string>();
    for (const t of tenants) {
      if ((await productRepository.countByTenant(t.id)) > 0) withProduct++;
      if ((await orderRepository.countByTenant(t.id)) > 0) {
        withOrder++;
        ordered.add(t.id);
      }
      const sub = db.findSubscriptionByTenantId(t.id);
      const version = sub ? versions.find((v) => v.id === sub.plan_version_id) : undefined;
      if (sub && sub.status === "ACTIVE" && version && mrrContribution(sub, version) > 0) paying++;
    }

    const since = Date.now() - weeks * 7 * 24 * 60 * 60 * 1000;
    const byWeek = new Map<string, { signups: number; with_order: number }>();
    for (let i = weeks - 1; i >= 0; i--) {
      byWeek.set(weekStart(new Date(Date.now() - i * 7 * 24 * 60 * 60 * 1000).toISOString()), { signups: 0, with_order: 0 });
    }
    for (const t of tenants) {
      if (Date.parse(t.created_at) < since) continue;
      const bucket = byWeek.get(weekStart(t.created_at));
      if (!bucket) continue;
      bucket.signups++;
      if (ordered.has(t.id)) bucket.with_order++;
    }

    return {
      workspaces: tenants.length,
      with_product: withProduct,
      with_order: withOrder,
      paying,
      weekly_cohorts: [...byWeek.entries()].map(([week_start, v]) => ({ week_start, ...v })),
    };
  }
}
