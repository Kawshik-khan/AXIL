import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 7: Analytics & Business Intelligence Domain Service
 * Strict deterministic calculations for GMV, AOV, Gross Margins, 64-District RTO,
 * multi-channel attribution, and executive business digests.
 * Zero-hallucination policy: all metrics derived from authoritative database records.
 */

import { db } from "@/infrastructure/db";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import {
  DatePreset,
  FinancialMetrics,
  TimeSeriesPoint,
  DistrictRtoMetric,
  DivisionRtoSummary,
  RtoGeographyReport,
  ChannelAttributionMetric,
  ChannelAttributionReport,
  ExecutiveDigest,
  DeliveryZone,
  RtoRiskTier,
  SalesChannel,
} from "@/types/analytics";
import { Order, OrderStatus } from "@/types/commerce";
import { PricingService } from "@/domains/pricing/pricing.service";

// All 64 districts of Bangladesh by division. Geography only: every count comes from the tenant's orders (FX-30).
export interface DistrictSpec {
  district: string;
  division: string;
  zone: DeliveryZone;
}

export const BD_64_DISTRICTS: DistrictSpec[] = [
  // Dhaka Division (13 Districts)
  { district: "Dhaka", division: "Dhaka", zone: "INSIDE_DHAKA" },
  { district: "Gazipur", division: "Dhaka", zone: "OUTSIDE_DHAKA" },
  { district: "Narayanganj", division: "Dhaka", zone: "OUTSIDE_DHAKA" },
  { district: "Narsingdi", division: "Dhaka", zone: "OUTSIDE_DHAKA" },
  { district: "Tangail", division: "Dhaka", zone: "OUTSIDE_DHAKA" },
  { district: "Kishoreganj", division: "Dhaka", zone: "OUTSIDE_DHAKA" },
  { district: "Manikganj", division: "Dhaka", zone: "OUTSIDE_DHAKA" },
  { district: "Munshiganj", division: "Dhaka", zone: "OUTSIDE_DHAKA" },
  { district: "Faridpur", division: "Dhaka", zone: "OUTSIDE_DHAKA" },
  { district: "Gopalganj", division: "Dhaka", zone: "OUTSIDE_DHAKA" },
  { district: "Madaripur", division: "Dhaka", zone: "OUTSIDE_DHAKA" },
  { district: "Rajbari", division: "Dhaka", zone: "OUTSIDE_DHAKA" },
  { district: "Shariatpur", division: "Dhaka", zone: "OUTSIDE_DHAKA" },

  // Chattogram Division (11 Districts)
  { district: "Chattogram", division: "Chattogram", zone: "OUTSIDE_DHAKA" },
  { district: "Cox's Bazar", division: "Chattogram", zone: "OUTSIDE_DHAKA" },
  { district: "Cumilla", division: "Chattogram", zone: "OUTSIDE_DHAKA" },
  { district: "Feni", division: "Chattogram", zone: "OUTSIDE_DHAKA" },
  { district: "Brahmanbaria", division: "Chattogram", zone: "OUTSIDE_DHAKA" },
  { district: "Noakhali", division: "Chattogram", zone: "OUTSIDE_DHAKA" },
  { district: "Lakshmipur", division: "Chattogram", zone: "OUTSIDE_DHAKA" },
  { district: "Chandpur", division: "Chattogram", zone: "OUTSIDE_DHAKA" },
  { district: "Khagrachhari", division: "Chattogram", zone: "OUTSIDE_DHAKA" },
  { district: "Rangamati", division: "Chattogram", zone: "OUTSIDE_DHAKA" },
  { district: "Bandarban", division: "Chattogram", zone: "OUTSIDE_DHAKA" },

  // Rajshahi Division (8 Districts)
  { district: "Rajshahi", division: "Rajshahi", zone: "OUTSIDE_DHAKA" },
  { district: "Bogura", division: "Rajshahi", zone: "OUTSIDE_DHAKA" },
  { district: "Pabna", division: "Rajshahi", zone: "OUTSIDE_DHAKA" },
  { district: "Sirajganj", division: "Rajshahi", zone: "OUTSIDE_DHAKA" },
  { district: "Naogaon", division: "Rajshahi", zone: "OUTSIDE_DHAKA" },
  { district: "Natore", division: "Rajshahi", zone: "OUTSIDE_DHAKA" },
  { district: "Chapainawabganj", division: "Rajshahi", zone: "OUTSIDE_DHAKA" },
  { district: "Joypurhat", division: "Rajshahi", zone: "OUTSIDE_DHAKA" },

  // Khulna Division (10 Districts)
  { district: "Khulna", division: "Khulna", zone: "OUTSIDE_DHAKA" },
  { district: "Jashore", division: "Khulna", zone: "OUTSIDE_DHAKA" },
  { district: "Kushtia", division: "Khulna", zone: "OUTSIDE_DHAKA" },
  { district: "Jhenaidah", division: "Khulna", zone: "OUTSIDE_DHAKA" },
  { district: "Chuadanga", division: "Khulna", zone: "OUTSIDE_DHAKA" },
  { district: "Meherpur", division: "Khulna", zone: "OUTSIDE_DHAKA" },
  { district: "Magura", division: "Khulna", zone: "OUTSIDE_DHAKA" },
  { district: "Narail", division: "Khulna", zone: "OUTSIDE_DHAKA" },
  { district: "Satkhira", division: "Khulna", zone: "OUTSIDE_DHAKA" },
  { district: "Bagerhat", division: "Khulna", zone: "OUTSIDE_DHAKA" },

  // Barishal Division (6 Districts)
  { district: "Barishal", division: "Barishal", zone: "OUTSIDE_DHAKA" },
  { district: "Patuakhali", division: "Barishal", zone: "OUTSIDE_DHAKA" },
  { district: "Bhola", division: "Barishal", zone: "OUTSIDE_DHAKA" },
  { district: "Pirojpur", division: "Barishal", zone: "OUTSIDE_DHAKA" },
  { district: "Barguna", division: "Barishal", zone: "OUTSIDE_DHAKA" },
  { district: "Jhalokati", division: "Barishal", zone: "OUTSIDE_DHAKA" },

  // Sylhet Division (4 Districts)
  { district: "Sylhet", division: "Sylhet", zone: "OUTSIDE_DHAKA" },
  { district: "Moulvibazar", division: "Sylhet", zone: "OUTSIDE_DHAKA" },
  { district: "Habiganj", division: "Sylhet", zone: "OUTSIDE_DHAKA" },
  { district: "Sunamganj", division: "Sylhet", zone: "OUTSIDE_DHAKA" },

  // Rangpur Division (8 Districts)
  { district: "Rangpur", division: "Rangpur", zone: "OUTSIDE_DHAKA" },
  { district: "Dinajpur", division: "Rangpur", zone: "OUTSIDE_DHAKA" },
  { district: "Gaibandha", division: "Rangpur", zone: "OUTSIDE_DHAKA" },
  { district: "Kurigram", division: "Rangpur", zone: "OUTSIDE_DHAKA" },
  { district: "Lalmonirhat", division: "Rangpur", zone: "OUTSIDE_DHAKA" },
  { district: "Nilphamari", division: "Rangpur", zone: "OUTSIDE_DHAKA" },
  { district: "Panchagarh", division: "Rangpur", zone: "OUTSIDE_DHAKA" },
  { district: "Thakurgaon", division: "Rangpur", zone: "OUTSIDE_DHAKA" },

  // Mymensingh Division (4 Districts)
  { district: "Mymensingh", division: "Mymensingh", zone: "OUTSIDE_DHAKA" },
  { district: "Jamalpur", division: "Mymensingh", zone: "OUTSIDE_DHAKA" },
  { district: "Netrokona", division: "Mymensingh", zone: "OUTSIDE_DHAKA" },
  { district: "Sherpur", division: "Mymensingh", zone: "OUTSIDE_DHAKA" },
];

/** Below this many shipments a district's RTO rate isn't meaningful and is reported as insufficient data. */
export const RTO_MIN_SHIPMENTS = 20;
/** Unit cost assumed when neither the variant nor the product has a cost price. Reported via cogs_estimated_share_pct. */
export const COGS_FALLBACK_RATIO = 0.42;

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (part: number, whole: number): number | null => (whole > 0 ? round1((part / whole) * 100) : null);

/** Orders that actually left the warehouse: the population for delivery and RTO rates. */
const SHIPPED_STATUSES = new Set<OrderStatus>(["SHIPPED", "DELIVERED", "RETURN_REQUESTED", "RETURNED"]);
const RTO_STATUSES = new Set<OrderStatus>(["RETURN_REQUESTED", "RETURNED"]);

const CHANNEL_NAMES: Record<SalesChannel, string> = {
  WHATSAPP: "WhatsApp",
  FACEBOOK_MESSENGER: "Facebook Messenger",
  INSTAGRAM: "Instagram",
  WEBSITE: "Website",
  MANUAL_POS: "Manual / POS",
  UNATTRIBUTED: "Unattributed (source or platform not recorded)",
};

/**
 * The channel an order came from, from what the order records. Social orders name their platform only in notes;
 * anything else, including imports, is UNATTRIBUTED rather than guessed (FX-30).
 */
export function channelOfOrder(order: Pick<Order, "source" | "notes">): SalesChannel {
  const source = (order.source as string) || "";
  const notes = (order.notes || "").toLowerCase();
  if (source === "WEBSITE") return "WEBSITE";
  if (source === "MANUAL") return "MANUAL_POS";
  if (source === "WHATSAPP" || notes.includes("whatsapp")) return "WHATSAPP";
  if (source === "INSTAGRAM" || notes.includes("instagram")) return "INSTAGRAM";
  if (source === "FACEBOOK" || notes.includes("facebook") || notes.includes("messenger")) return "FACEBOOK_MESSENGER";
  return "UNATTRIBUTED";
}

export class AnalyticsService {
  /**
   * Financial metrics from the tenant's orders and refunds (FX-30).
   * GMV = SUM(order.grand_total), which is already net of discounts
   * NMV = GMV - refunds
   * AOV = GMV / orders_count
   * COGS = SUM(quantity * unit_cost); unit_cost falls back to COGS_FALLBACK_RATIO of the price when unknown, and the
   *        share of COGS that is estimated this way is reported
   * Gross Margin % = (GMV - COGS) / GMV * 100, null without revenue
   * Period change % = against the previous window of the same length, null when that window had no revenue
   */
  public static async getFinancialMetrics(
    context: RequestContext,
    preset: DatePreset = "30D"
  ): Promise<FinancialMetrics> {
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_READ);

    const tenantId = context.tenant.id;
    const orders = db.getAllOrders(tenantId, { hydrate: true });
    const refunds = db.getRefunds(tenantId);
    const costs = this.unitCosts(tenantId);

    const { startMs, endMs, intervalDays } = this.resolveDateRange(preset);
    const inWindow = (iso: string, from: number, to: number) => {
      const t = new Date(iso).getTime();
      return t >= from && t <= to;
    };

    const filteredOrders = orders.filter((o) => o.status !== "CANCELLED" && inWindow(o.created_at, startMs, endMs));

    let gmv_bdt = 0;
    let total_discounts_bdt = 0;
    let completed_orders_count = 0;
    let cogs_bdt = 0;
    let estimated_cogs_bdt = 0;

    for (const order of filteredOrders) {
      gmv_bdt += order.grand_total;
      total_discounts_bdt += order.discount_total || 0;
      if (order.status === "DELIVERED" || order.status === "CONFIRMED" || order.status === "SHIPPED") {
        completed_orders_count += 1;
      }
      const cogs = this.orderCogs(order, costs);
      cogs_bdt += cogs.total;
      estimated_cogs_bdt += cogs.estimated;
    }

    const total_refunds_bdt = refunds
      .filter((r) => inWindow(r.created_at, startMs, endMs))
      .reduce((sum, r) => sum + r.amount, 0);

    // Previous window of the same length, for the period-over-period change.
    const spanMs = endMs - startMs;
    const previousGmv = orders
      .filter((o) => o.status !== "CANCELLED")
      .filter((o) => {
        const t = new Date(o.created_at).getTime();
        return t >= startMs - spanMs && t < startMs;
      })
      .reduce((sum, o) => sum + o.grand_total, 0);

    const gross_profit_bdt = Math.round(gmv_bdt - cogs_bdt);

    return {
      gmv_bdt: Math.round(gmv_bdt),
      nmv_bdt: Math.max(0, Math.round(gmv_bdt - total_refunds_bdt)),
      aov_bdt: filteredOrders.length > 0 ? Math.round(gmv_bdt / filteredOrders.length) : 0,
      cogs_bdt: Math.round(cogs_bdt),
      cogs_estimated_share_pct: pct(estimated_cogs_bdt, cogs_bdt) ?? 0,
      gross_profit_bdt,
      gross_margin_pct: pct(gross_profit_bdt, gmv_bdt),
      completed_orders_count,
      total_orders_count: filteredOrders.length,
      total_discounts_bdt: Math.round(total_discounts_bdt),
      total_refunds_bdt: Math.round(total_refunds_bdt),
      period_change_pct: previousGmv > 0 ? round1(((gmv_bdt - previousGmv) / previousGmv) * 100) : null,
      time_series: this.generateTimeSeriesPoints(filteredOrders, startMs, endMs, intervalDays, costs),
    };
  }

  /**
   * Return-to-Origin by district, from the tenant's shipped orders only (FX-30). A district with fewer than
   * RTO_MIN_SHIPMENTS shipments is INSUFFICIENT_DATA with a null rate.
   */
  public static async getRtoGeographyReport(
    context: RequestContext,
    options?: { division?: string; search?: string }
  ): Promise<RtoGeographyReport> {
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_READ);

    const tenantId = context.tenant.id;
    const orders = db.getAllOrders(tenantId);

    const stats = new Map<string, { shipped: number; delivered: number; rto: number; cod: number }>();
    for (const order of orders) {
      const district = order.shipping_address_snapshot?.district;
      if (!district || !SHIPPED_STATUSES.has(order.status)) continue;
      const cur = stats.get(district) || { shipped: 0, delivered: 0, rto: 0, cod: 0 };
      cur.shipped += 1;
      if (order.status === "DELIVERED") cur.delivered += 1;
      if (RTO_STATUSES.has(order.status)) cur.rto += 1;
      if (order.payment_method === "COD") cur.cod += 1;
      stats.set(district, cur);
    }

    const evaluatedDistricts: DistrictRtoMetric[] = BD_64_DISTRICTS.map((spec) => {
      const s = stats.get(spec.district) || { shipped: 0, delivered: 0, rto: 0, cod: 0 };
      const enough = s.shipped >= RTO_MIN_SHIPMENTS;
      const rto_rate_pct = enough ? pct(s.rto, s.shipped) : null;

      let risk_tier: RtoRiskTier = "INSUFFICIENT_DATA";
      let recommendation = `Not enough shipments to assess (${s.shipped} of the ${RTO_MIN_SHIPMENTS} needed).`;
      if (rto_rate_pct !== null) {
        if (rto_rate_pct > 15) {
          risk_tier = "HIGH_RISK";
          recommendation = "High refusal rate: consider asking for a delivery-charge advance via bKash/Nagad before dispatch.";
        } else if (rto_rate_pct >= 8) {
          risk_tier = "MODERATE";
          recommendation = "Confirm by phone or WhatsApp and send the tracking link before shipping.";
        } else {
          risk_tier = "LOW";
          recommendation = "Low refusal rate: standard COD.";
        }
      }

      return {
        district: spec.district,
        division: spec.division,
        zone: spec.zone,
        total_shipments: s.shipped,
        delivered_count: s.delivered,
        rto_count: s.rto,
        in_transit_count: Math.max(0, s.shipped - s.delivered - s.rto),
        rto_rate_pct,
        cod_share_pct: pct(s.cod, s.shipped),
        risk_tier,
        recommendation,
      };
    });

    let filteredDistricts = evaluatedDistricts;
    if (options?.division && options.division !== "ALL") {
      filteredDistricts = filteredDistricts.filter((d) => d.division.toLowerCase() === options.division!.toLowerCase());
    }
    if (options?.search && options.search.trim()) {
      const q = options.search.toLowerCase().trim();
      filteredDistricts = filteredDistricts.filter(
        (d) => d.district.toLowerCase().includes(q) || d.division.toLowerCase().includes(q)
      );
    }

    const sum = (list: DistrictRtoMetric[], key: "total_shipments" | "rto_count" | "delivered_count") =>
      list.reduce((acc, d) => acc + d[key], 0);

    const divisionGroups = new Map<string, DistrictRtoMetric[]>();
    for (const d of evaluatedDistricts) {
      const list = divisionGroups.get(d.division) || [];
      list.push(d);
      divisionGroups.set(d.division, list);
    }

    const divisions_summary: DivisionRtoSummary[] = Array.from(divisionGroups.entries()).map(([division, dists]) => {
      const total_shipments = sum(dists, "total_shipments");
      const rto_count = sum(dists, "rto_count");
      const assessed = dists.filter((d) => d.rto_rate_pct !== null).sort((a, b) => (b.rto_rate_pct ?? 0) - (a.rto_rate_pct ?? 0));
      return {
        division,
        districts_count: dists.length,
        total_shipments,
        delivered_count: sum(dists, "delivered_count"),
        rto_count,
        rto_rate_pct: total_shipments >= RTO_MIN_SHIPMENTS ? pct(rto_count, total_shipments) : null,
        highest_risk_district: assessed[0] ? `${assessed[0].district} (${assessed[0].rto_rate_pct}%)` : null,
      };
    });

    const zoneRate = (list: DistrictRtoMetric[]) => {
      const shipped = sum(list, "total_shipments");
      return shipped >= RTO_MIN_SHIPMENTS ? pct(sum(list, "rto_count"), shipped) : null;
    };

    return {
      overall_rto_rate_pct: zoneRate(evaluatedDistricts),
      inside_dhaka_rto_pct: zoneRate(evaluatedDistricts.filter((d) => d.zone === "INSIDE_DHAKA")),
      outside_dhaka_rto_pct: zoneRate(evaluatedDistricts.filter((d) => d.zone === "OUTSIDE_DHAKA")),
      total_shipments_evaluated: sum(evaluatedDistricts, "total_shipments"),
      minimum_shipments_for_rate: RTO_MIN_SHIPMENTS,
      delivery_fees: PricingService.getDeliveryFees(tenantId),
      divisions_summary,
      districts: filteredDistricts,
      high_risk_districts_count: evaluatedDistricts.filter((d) => d.risk_tier === "HIGH_RISK").length,
    };
  }

  /**
   * Orders and GMV by channel, from the tenant's orders only (FX-30). There is no visit or session data, so
   * conversion is null; orders whose channel isn't recorded are UNATTRIBUTED.
   */
  public static async getChannelAttributionReport(
    context: RequestContext,
    preset: DatePreset = "30D"
  ): Promise<ChannelAttributionReport> {
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_READ);

    const tenantId = context.tenant.id;
    const { startMs, endMs } = this.resolveDateRange(preset);
    const filteredOrders = db.getAllOrders(tenantId).filter((o) => {
      const t = new Date(o.created_at).getTime();
      return t >= startMs && t <= endMs && o.status !== "CANCELLED";
    });

    const tallies = new Map<SalesChannel, { orders: number; gmv: number; shipped: number; rto: number; cod: number }>();
    for (const key of Object.keys(CHANNEL_NAMES) as SalesChannel[]) {
      tallies.set(key, { orders: 0, gmv: 0, shipped: 0, rto: 0, cod: 0 });
    }
    for (const order of filteredOrders) {
      const t = tallies.get(channelOfOrder(order))!;
      t.orders += 1;
      t.gmv += order.grand_total;
      if (order.payment_method === "COD") t.cod += 1;
      if (SHIPPED_STATUSES.has(order.status)) t.shipped += 1;
      if (RTO_STATUSES.has(order.status)) t.rto += 1;
    }

    const total_gmv_bdt = Math.round(filteredOrders.reduce((acc, o) => acc + o.grand_total, 0));
    const total_orders_count = filteredOrders.length;

    const channels: ChannelAttributionMetric[] = Array.from(tallies.entries())
      .filter(([key, t]) => t.orders > 0 || key !== "UNATTRIBUTED")
      .map(([key, t]) => ({
        channel: key,
        channel_name: CHANNEL_NAMES[key],
        orders_count: t.orders,
        orders_share_pct: pct(t.orders, total_orders_count) ?? 0,
        gmv_bdt: Math.round(t.gmv),
        gmv_share_pct: pct(t.gmv, total_gmv_bdt) ?? 0,
        aov_bdt: t.orders > 0 ? Math.round(t.gmv / t.orders) : 0,
        conversion_rate_pct: null, // no visit/session data exists
        rto_rate_pct: pct(t.rto, t.shipped),
        cod_share_pct: pct(t.cod, t.orders),
      }))
      .sort((a, b) => b.gmv_bdt - a.gmv_bdt);

    return {
      total_gmv_bdt,
      total_orders_count,
      channels,
      top_channel_by_gmv: total_orders_count > 0 ? channels[0]?.channel_name ?? null : null,
      top_channel_by_conversion: null,
    };
  }

  /**
   * Executive Business Digests Archive & Synthesis
   */
  public static async getExecutiveDigests(context: RequestContext): Promise<ExecutiveDigest[]> {
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_READ);
    return db.getExecutiveDigests(context.tenant.id);
  }

  public static async getExecutiveDigestById(
    context: RequestContext,
    id: string
  ): Promise<ExecutiveDigest | undefined> {
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_READ);
    return db.getExecutiveDigestById(context.tenant.id, id);
  }

  /**
   * Generates an Executive Business Digest from the reports above. Every sentence is built from a computed number;
   * where a number is unknown the digest says so instead of guessing (FX-30).
   */
  public static async generateExecutiveDigest(
    context: RequestContext,
    payload: { period_type: "DAILY" | "WEEKLY" | "MONTHLY" }
  ): Promise<ExecutiveDigest> {
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_READ);

    const tenantId = context.tenant.id;
    const periodType = payload.period_type || "DAILY";
    const days = periodType === "DAILY" ? 1 : periodType === "WEEKLY" ? 7 : 30;

    const preset: DatePreset = periodType === "DAILY" ? "TODAY" : periodType === "WEEKLY" ? "7D" : "30D";
    const financials = await this.getFinancialMetrics(context, preset);
    const channelsReport = await this.getChannelAttributionReport(context, preset);
    const rtoReport = await this.getRtoGeographyReport(context);

    const now = new Date();
    const periodStart = new Date(now.getTime() - days * 86400000).toISOString();
    const periodEnd = now.toISOString();

    const highRiskDistricts = rtoReport.districts
      .filter((d) => d.risk_tier === "HIGH_RISK")
      .slice(0, 3)
      .map((d) => ({ district: d.district, division: d.division, rto_pct: d.rto_rate_pct, risk_tier: d.risk_tier }));

    const topChannels = channelsReport.channels
      .filter((c) => c.orders_count > 0)
      .slice(0, 3)
      .map((c) => ({
        channel: c.channel,
        gmv_bdt: c.gmv_bdt,
        share_pct: c.gmv_share_pct,
        highlight: `${c.channel_name}: ৳${c.gmv_bdt.toLocaleString()} from ${c.orders_count} orders (${c.gmv_share_pct}% of GMV).`,
      }));

    const fmt = (v: number | null, suffix = "%") => (v === null ? "not enough data" : `${v}${suffix}`);
    const strategic_recommendations: string[] = [];
    if (topChannels[0]) {
      strategic_recommendations.push(`${channelsReport.top_channel_by_gmv} brought the most revenue this period (৳${topChannels[0].gmv_bdt.toLocaleString()}).`);
    }
    if (highRiskDistricts.length > 0) {
      strategic_recommendations.push(
        `Consider a delivery-charge advance for ${highRiskDistricts.map((d) => d.district).join(", ")}, where more than 15% of shipments came back.`
      );
    }
    if (financials.cogs_estimated_share_pct > 0) {
      strategic_recommendations.push(
        `${financials.cogs_estimated_share_pct}% of cost of goods is estimated because products have no cost price; add cost prices for an accurate margin.`
      );
    }

    const digest: ExecutiveDigest = {
      id: `ed_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      period_type: periodType,
      period_start: periodStart,
      period_end: periodEnd,
      title: `${periodType.charAt(0) + periodType.slice(1).toLowerCase()} business summary`,
      executive_summary:
        financials.total_orders_count === 0
          ? `No orders in this ${periodType.toLowerCase()} period.`
          : `GMV was ৳${financials.gmv_bdt.toLocaleString()} from ${financials.total_orders_count} orders (AOV ৳${financials.aov_bdt.toLocaleString()}). Gross margin: ${fmt(financials.gross_margin_pct)}. Change from the previous period: ${fmt(financials.period_change_pct)}. Return-to-origin rate: ${fmt(rtoReport.overall_rto_rate_pct)}.`,
      financial_summary: {
        gmv_bdt: financials.gmv_bdt,
        aov_bdt: financials.aov_bdt,
        gross_margin_pct: financials.gross_margin_pct,
        orders_count: financials.total_orders_count,
        rto_rate_pct: rtoReport.overall_rto_rate_pct,
      },
      channel_highlights: topChannels,
      rto_hotspots: highRiskDistricts,
      strategic_recommendations,
      generated_by_agent: "ANALYTICS_AGENT",
      created_at: now.toISOString(),
    };

    return db.insertExecutiveDigest(digest);
  }

  // Helper: Date range resolution
  private static resolveDateRange(preset: DatePreset): {
    startMs: number;
    endMs: number;
    intervalDays: number;
  } {
    const now = new Date();
    const endMs = now.getTime();
    let intervalDays = 30;

    switch (preset) {
      case "TODAY": {
        const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        return { startMs: midnight, endMs, intervalDays: 1 };
      }
      case "7D":
        intervalDays = 7;
        break;
      case "30D":
        intervalDays = 30;
        break;
      case "90D":
        intervalDays = 90;
        break;
      case "YTD": {
        const startOfYear = new Date(now.getFullYear(), 0, 1).getTime();
        const diffDays = Math.max(1, Math.round((endMs - startOfYear) / 86400000));
        return { startMs: startOfYear, endMs, intervalDays: diffDays };
      }
      case "ALL":
        intervalDays = 365;
        break;
    }

    const startMs = endMs - intervalDays * 86400000;
    return { startMs, endMs, intervalDays };
  }

  /** Unit cost per variant where one is recorded (variant cost price, else product cost price). */
  private static unitCosts(tenantId: string): Map<string, number> {
    const productsById = new Map(db.getAllProducts(tenantId).map((p) => [p.id, p])); // O(V + P) (FX-23)
    const costs = new Map<string, number>();
    for (const v of db.getAllProductVariants(tenantId)) {
      const productCost = productsById.get(v.product_id)?.cost_price;
      if (v.cost_price && v.cost_price > 0) costs.set(v.id, v.cost_price);
      else if (productCost && productCost > 0) costs.set(v.id, productCost);
    }
    return costs;
  }

  /** COGS of one order, and how much of it is estimated with COGS_FALLBACK_RATIO. */
  private static orderCogs(order: Order, costs: Map<string, number>): { total: number; estimated: number } {
    if (!order.items || order.items.length === 0) {
      const estimate = order.subtotal * COGS_FALLBACK_RATIO;
      return { total: estimate, estimated: estimate };
    }
    let total = 0;
    let estimated = 0;
    for (const item of order.items) {
      const known = costs.get(item.variant_id);
      const line = item.quantity * (known ?? item.unit_price * COGS_FALLBACK_RATIO);
      total += line;
      if (known === undefined) estimated += line;
    }
    return { total, estimated };
  }

  /** Real buckets only: an empty bucket has 0 GMV and 0 orders, and null AOV and margin (FX-30). */
  private static generateTimeSeriesPoints(
    orders: Order[],
    startMs: number,
    endMs: number,
    intervalDays: number,
    costs: Map<string, number>
  ): TimeSeriesPoint[] {
    const pointsCount = Math.max(1, Math.min(intervalDays, 14)); // keep the chart readable with 7-14 points
    const stepMs = (endMs - startMs) / pointsCount;
    const buckets = Array.from({ length: pointsCount }, () => ({ gmv: 0, cogs: 0, orders: 0 }));

    for (const o of orders) {
      const idx = Math.min(pointsCount - 1, Math.floor((new Date(o.created_at).getTime() - startMs) / stepMs));
      if (idx < 0) continue;
      buckets[idx].gmv += o.grand_total;
      buckets[idx].cogs += this.orderCogs(o, costs).total;
      buckets[idx].orders += 1;
    }

    return buckets.map((b, i) => ({
      date: new Date(startMs + i * stepMs).toISOString().split("T")[0],
      gmv_bdt: Math.round(b.gmv),
      orders_count: b.orders,
      aov_bdt: b.orders > 0 ? Math.round(b.gmv / b.orders) : null,
      gross_margin_pct: pct(b.gmv - b.cogs, b.gmv),
    }));
  }
}

export const analyticsService = AnalyticsService;
