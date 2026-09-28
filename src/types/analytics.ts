/**
 * CommerceOS Phase 7: Analytics & Business Intelligence Contracts
 * Strictly typed contracts for deterministic financials, 64-district RTO, channel attribution, and executive digests.
 */

export type DatePreset = "TODAY" | "7D" | "30D" | "90D" | "YTD" | "ALL";

export interface TimeSeriesPoint {
  date: string;
  gmv_bdt: number;
  /** null when the bucket has no orders */
  aov_bdt: number | null;
  /** null when the bucket has no revenue */
  gross_margin_pct: number | null;
  orders_count: number;
}

export interface FinancialMetrics {
  gmv_bdt: number;
  nmv_bdt: number;
  aov_bdt: number;
  cogs_bdt: number;
  /** Share of COGS estimated because no cost price is recorded (FX-30). */
  cogs_estimated_share_pct: number;
  gross_profit_bdt: number;
  /** null without revenue */
  gross_margin_pct: number | null;
  completed_orders_count: number;
  total_orders_count: number;
  total_discounts_bdt: number;
  total_refunds_bdt: number;
  /** Against the previous window of the same length; null when that window had no revenue. */
  period_change_pct: number | null;
  time_series: TimeSeriesPoint[];
}

export type DeliveryZone = "INSIDE_DHAKA" | "OUTSIDE_DHAKA";

export type RtoRiskTier = "LOW" | "MODERATE" | "HIGH_RISK" | "INSUFFICIENT_DATA";

export interface DistrictRtoMetric {
  district: string;
  division: string;
  zone: DeliveryZone;
  total_shipments: number;
  delivered_count: number;
  rto_count: number;
  in_transit_count: number;
  /** null below the minimum number of shipments */
  rto_rate_pct: number | null;
  /** null without shipments */
  cod_share_pct: number | null;
  risk_tier: RtoRiskTier;
  recommendation: string;
}

export interface DivisionRtoSummary {
  division: string;
  districts_count: number;
  total_shipments: number;
  delivered_count: number;
  rto_count: number;
  rto_rate_pct: number | null;
  highest_risk_district: string | null;
}

export interface RtoGeographyReport {
  overall_rto_rate_pct: number | null;
  inside_dhaka_rto_pct: number | null;
  outside_dhaka_rto_pct: number | null;
  total_shipments_evaluated: number;
  minimum_shipments_for_rate: number;
  /** The tenant's delivery charges, from settings. */
  delivery_fees: { inside_dhaka_bdt: number; outside_dhaka_bdt: number };
  divisions_summary: DivisionRtoSummary[];
  districts: DistrictRtoMetric[];
  high_risk_districts_count: number;
}

export type SalesChannel =
  | "FACEBOOK_MESSENGER"
  | "WHATSAPP"
  | "WEBSITE"
  | "INSTAGRAM"
  | "MANUAL_POS"
  | "UNATTRIBUTED";

export interface ChannelAttributionMetric {
  channel: SalesChannel;
  channel_name: string;
  orders_count: number;
  orders_share_pct: number;
  gmv_bdt: number;
  gmv_share_pct: number;
  aov_bdt: number;
  /** Always null: there is no visit or session data to convert from. */
  conversion_rate_pct: number | null;
  rto_rate_pct: number | null;
  cod_share_pct: number | null;
}

export interface ChannelAttributionReport {
  total_gmv_bdt: number;
  total_orders_count: number;
  channels: ChannelAttributionMetric[];
  top_channel_by_gmv: string | null;
  top_channel_by_conversion: string | null;
}

export interface ExecutiveDigest {
  id: string;
  tenant_id: string;
  period_type: "DAILY" | "WEEKLY" | "MONTHLY";
  period_start: string;
  period_end: string;
  title: string;
  executive_summary: string;
  financial_summary: {
    gmv_bdt: number;
    aov_bdt: number;
    gross_margin_pct: number | null;
    orders_count: number;
    rto_rate_pct: number | null;
  };
  channel_highlights: Array<{
    channel: string;
    gmv_bdt: number;
    share_pct: number;
    highlight: string;
  }>;
  rto_hotspots: Array<{
    district: string;
    division: string;
    rto_pct: number | null;
    risk_tier: string;
  }>;
  strategic_recommendations: string[];
  generated_by_agent: "ANALYTICS_AGENT";
  created_at: string;
}
