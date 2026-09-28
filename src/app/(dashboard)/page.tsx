"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  TrendingUp,
  ShoppingBag,
  Users,
  Percent,
  ShieldCheck,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  Sparkles,
  Clock,
  Truck,
  Boxes,
  CreditCard,
  RotateCcw,
  MessageSquare,
  Globe,
  Plus,
  Package,
  ChevronRight,
  Activity,
  Cpu,
  Bot,
  Zap,
  Calendar,
  ChevronDown,
  ExternalLink,
  Flame,
  Search,
  MapPin,
  Repeat,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge/Badge";
import { Button } from "@/components/ui/Button/Button";
import { LoadingState } from "@/components/ui/States/States";
import styles from "./dashboard.module.css";
import type { db } from "@/infrastructure/db";
import type { FinancialMetrics } from "@/types/analytics";
import type { AgentRun } from "@/types/ai";
import type { Opportunity, Recommendation, Risk } from "@/types/intelligence";

/** Shapes of the endpoints this page reads (type-only; nothing server-side is bundled). */
type DashboardMetrics = ReturnType<typeof db.getDashboardMetrics>;
interface IntelligenceOverview {
  top_risks?: Risk[];
  top_opportunities?: Opportunity[];
  top_recommendations?: Recommendation[];
  snapshots?: Array<{ source: string }>;
}

type CurrencyCode = "BDT" | "USD" | "EUR" | "GBP";

interface CurrencyConfig {
  code: CurrencyCode;
  symbol: string;
  name: string;
  rate: number; // 1 BDT = rate in target currency
  format: (amountBDT: number) => string;
}

const CURRENCIES: Record<CurrencyCode, CurrencyConfig> = {
  BDT: {
    code: "BDT",
    symbol: "৳",
    name: "Bangladeshi Taka (৳)",
    rate: 1,
    format: (amt) => `৳${Math.round(amt).toLocaleString("en-BD")}`,
  },
  USD: {
    code: "USD",
    symbol: "$",
    name: "US Dollar ($)",
    rate: 1 / 110,
    format: (amt) => `≈$${Math.round(amt / 110).toLocaleString("en-US")}`, // fixed display rate, not live FX
  },
  EUR: {
    code: "EUR",
    symbol: "€",
    name: "Euro (€)",
    rate: 0.92 / 110,
    format: (amt) => `≈€${Math.round((amt * 0.92) / 110).toLocaleString("de-DE")}`,
  },
  GBP: {
    code: "GBP",
    symbol: "£",
    name: "British Pound (£)",
    rate: 0.79 / 110,
    format: (amt) => `≈£${Math.round((amt * 0.79) / 110).toLocaleString("en-GB")}`,
  },
};

export default function DashboardPage() {
  const [session, setSession] = useState<any>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [financials, setFinancials] = useState<FinancialMetrics | null>(null);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [intelligence, setIntelligence] = useState<IntelligenceOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Currency state (Bangladesh-first default BDT ৳)
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode>("BDT");

  // Interactive Donut Chart state
  const [hoveredChannel, setHoveredChannel] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);

  // City Orders & Returning Buyer Analysis state
  const [cityViewTab, setCityViewTab] = useState<"orders" | "retention">("orders");
  const [selectedCity, setSelectedCity] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      // Every number on this page comes from these endpoints (FX-39). A failed request leaves its section empty.
      const read = async (url: string) => {
        try {
          const res = await fetch(url);
          return res.ok ? (await res.json()).data : null;
        } catch {
          return null;
        }
      };
      const [s, m, fin, runs, intel] = await Promise.all([
        read("/api/v1/auth/session"),
        read("/api/v1/reports/dashboard"),
        read("/api/v1/analytics/financials?preset=30D"),
        read("/api/v1/ai/runs?limit=5"),
        read("/api/v1/intelligence/overview"),
      ]);
      setSession(s);
      if (s?.tenant?.currency && CURRENCIES[s.tenant.currency as CurrencyCode]) {
        setSelectedCurrency(s.tenant.currency as CurrencyCode);
      }
      setMetrics(m?.metrics ?? null);
      setFinancials(fin?.financials ?? null);
      setAgentRuns(Array.isArray(runs) ? runs.slice(0, 5) : []);
      setIntelligence(intel ?? null);
      setIsLoading(false);
    }
    loadData();
  }, []);

  const cur = CURRENCIES[selectedCurrency];

  // Real values only: no fallbacks when a value is 0 or missing (FX-39: these used to be ৳184,500 / 1,420 / ৳1,299 / 24.8%)
  const netRevenueBDT: number = metrics?.totalRevenue ?? 0;
  const totalOrders: number = metrics?.totalOrders ?? 0;
  const activeCustomers: number = metrics?.activeCustomers ?? 0;
  const aovBDT: number = metrics?.averageOrderValue ?? 0;
  const marginPercent: number | null = typeof financials?.gross_margin_pct === "number" ? financials.gross_margin_pct : null;
  const comparison = metrics?.periodComparison;

  const channelData = metrics?.channelData ?? [];
  const activeChannel = channelData.find((c) => c.shortName === (hoveredChannel || selectedChannel));
  const topChannel = [...channelData].sort((a, b) => b.orders - a.orders)[0];

  const cityAnalysisData = metrics?.cityAnalysisData ?? [];
  const topCity = cityAnalysisData[0];

  // Needs Attention: built from real counts, linking to the filtered lists (was five invented items)
  const attentionItems = [
    {
      id: "att_orders",
      count: metrics?.pendingOrdersCount ?? 0,
      icon: <Package size={18} color="#ffffff" />,
      color: "#f59e0b",
      title: "Orders to process",
      subtitle: "Pending, confirmed or processing orders",
      actionText: "Open orders →",
      href: "/orders?status=CONFIRMED",
    },
    {
      id: "att_payments",
      count: metrics?.pendingPaymentsCount ?? 0,
      icon: <CreditCard size={18} color="#ffffff" />,
      color: "#e2136e",
      title: "Payments to verify",
      subtitle: "Orders with an unpaid or pending payment",
      actionText: "Verify payments →",
      href: "/orders?payment_status=PENDING",
    },
    {
      id: "att_stock",
      count: metrics?.lowStockCount ?? 0,
      icon: <Boxes size={18} color="#ffffff" />,
      color: "#84cc16",
      title: "SKUs at or below reorder point",
      subtitle: "Stock that needs replenishing",
      actionText: "Open inventory →",
      href: "/inventory?low_stock_only=true",
    },
  ].filter((item) => item.count > 0);

  // Agent activity from recorded runs (was an invented stream)
  const since = (iso: string) => {
    const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
    return mins < 1 ? "Just now" : mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.round(mins / 60)}h ago` : `${Math.round(mins / 1440)}d ago`;
  };
  const agentStream = agentRuns.map((run) => ({
    time: run.started_at ? since(run.started_at) : "—",
    agent: String(run.agent_type ?? "Agent").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
    action: run.final_response ? String(run.final_response).slice(0, 90) : run.error_message ? String(run.error_message).slice(0, 90) : `Step: ${run.current_step ?? "—"}`,
    status: run.status ?? "—",
  }));

  // Recent orders from the store (was five fictional customers with names and phone numbers)
  const recentOrders = (metrics?.recentOrders ?? []).map((o) => ({
    id: o.order_number,
    customer: o.customer_name,
    city: o.shipping_address_snapshot?.district || o.shipping_address_snapshot?.division || "—",
    isReturning: Boolean(o.is_returning),
    channel: o.channel ?? "—",
    amountBDT: o.grand_total ?? 0,
    payment: `${o.payment_method ?? "—"} · ${o.payment_status ?? "—"}`,
    status: o.status,
    delivery: o.courier ?? "—",
  }));

  // A computed change, or nothing (was literal +18.4% / +12.6% / +8.2% / +5.4% / +3.1%)
  const trendPill = (value: number | null | undefined, label: string) =>
    typeof value === "number" ? (
      <>
        <span className={value >= 0 ? styles.trendPillGreen : styles.trendPillRed}>
          {value >= 0 ? "+" : ""}
          {value}% {value >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
        </span>
        <span className={styles.trendMutedText}>{label}</span>
      </>
    ) : (
      <span className={styles.trendMutedText}>No prior 30 days to compare</span>
    );

  if (isLoading) {
    return <LoadingState message="Connecting to CommerceOS Command Center..." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* 0. Top Command Center Header */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>
            <span>CommerceOS Command Center</span>
            <span style={{ fontSize: "14px", fontWeight: 400, color: "var(--color-text-muted)" }}>
              / Business Operations
            </span>
          </h1>
          <p className={styles.pageDescription}>
            Authoritative multi-channel intelligence, automated fulfillment, and F-commerce revenue for{" "}
            <strong>{session?.tenant?.name || "your store"}</strong>.
          </p>
        </div>

        {/* Universal Currency & Quick Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {/* Currency Switcher */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 12px",
              background: "#ffffff",
              border: "1px solid rgba(0, 0, 0, 0.1)",
              borderRadius: "14px",
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
            }}
          >
            <span style={{ fontSize: "12px", color: "#6b7280", fontWeight: 500 }}>Currency:</span>
            <select
              value={selectedCurrency}
              onChange={(e) => setSelectedCurrency(e.target.value as CurrencyCode)}
              style={{
                border: "none",
                background: "transparent",
                fontSize: "13px",
                fontWeight: 700,
                color: "#111827",
                cursor: "pointer",
                outline: "none",
              }}
            >
              <option value="BDT">৳ BDT (Bangladesh)</option>
              <option value="USD">$ USD (Universal)</option>
              <option value="EUR">€ EUR (Euro)</option>
              <option value="GBP">£ GBP (British Pound)</option>
            </select>
          </div>

          <Link href="/orders">
            <Button variant="primary" size="sm" icon={<Plus size={14} />}>
              + Create Order
            </Button>
          </Link>
        </div>
      </div>

      {/* Developer Role Shortcut (If active role is DEV) */}
      {session?.role === "DEV" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            background: "rgba(168, 85, 247, 0.08)",
            border: "1px solid rgba(168, 85, 247, 0.25)",
            borderRadius: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <Badge variant="dev">DEV ROLE</Badge>
            <span style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
              <strong>Developer Portal:</strong> The technical <strong>Agent Gateway</strong>, Policy Engine telemetry, and tool registry live in the dedicated <strong>AI Agents</strong> console.
            </span>
          </div>
          <Link href="/agents">
            <Button variant="outline" size="sm" icon={<Sparkles size={14} color="#a855f7" />}>
              Open Agent Gateway →
            </Button>
          </Link>
        </div>
      )}

      {/* ======================================================= */}
      {/* TIER 1: BUSINESS-FIRST TOP 5 KPIS                       */}
      {/* ======================================================= */}
      <section className={styles.kpiGrid5} aria-label="Business Performance KPIs">
        {/* KPI 1: Net Revenue (Dark Hero Card with Lime Accent) */}
        <div className={styles.kpiCardDark}>
          <div>
            <div className={styles.kpiTopRow}>
              <div
                className={styles.iconCircle}
                style={{
                  background: "rgba(199, 249, 0, 0.16)",
                  border: "1px solid rgba(199, 249, 0, 0.35)",
                }}
              >
                <TrendingUp size={20} color="#C7F900" />
              </div>
              <Link href="/analytics" className={styles.actionArrow} aria-label="View revenue analytics">
                <ArrowUpRight size={16} />
              </Link>
            </div>

            <div className={styles.kpiMidLabel}>Net Revenue ({cur.symbol})</div>
            <div className={styles.kpiBigNumber}>{cur.format(netRevenueBDT)}</div>
          </div>

          <div className={styles.kpiBottomRow}>{trendPill(comparison?.revenue_change_pct, "last 30 days vs previous")}</div>
        </div>

        {/* KPI 2: Total Orders */}
        <div className={styles.kpiCardLight}>
          <div>
            <div className={styles.kpiTopRow}>
              <div
                className={styles.iconCircle}
                style={{
                  background: "rgba(59, 130, 246, 0.14)",
                  color: "#2563eb",
                }}
              >
                <ShoppingBag size={20} color="#2563eb" />
              </div>
              <Link href="/orders" className={styles.actionArrow} aria-label="View orders">
                <ArrowUpRight size={16} />
              </Link>
            </div>

            <div className={styles.kpiMidLabel}>Total Orders</div>
            <div className={styles.kpiBigNumber}>{totalOrders.toLocaleString()} Orders</div>
          </div>

          <div className={styles.kpiBottomRow}>{trendPill(comparison?.orders_change_pct, "last 30 days vs previous")}</div>
        </div>

        {/* KPI 3: Active Customers */}
        <div className={styles.kpiCardLight}>
          <div>
            <div className={styles.kpiTopRow}>
              <div
                className={styles.iconCircle}
                style={{
                  background: "rgba(168, 85, 247, 0.14)",
                  color: "#9333ea",
                }}
              >
                <Users size={20} color="#9333ea" />
              </div>
              <Link href="/customers" className={styles.actionArrow} aria-label="View customers">
                <ArrowUpRight size={16} />
              </Link>
            </div>

            <div className={styles.kpiMidLabel}>Active Customers</div>
            <div className={styles.kpiBigNumber}>{activeCustomers.toLocaleString()}</div>
          </div>

          <div className={styles.kpiBottomRow}>
            <span className={styles.trendMutedText}>
              {typeof metrics?.returningBuyerPercent === "number" ? `${metrics.returningBuyerPercent}% repeat buyers` : "No buyers yet"}
            </span>
          </div>
        </div>

        {/* KPI 4: Average Order Value (AOV) */}
        <div className={styles.kpiCardLight}>
          <div>
            <div className={styles.kpiTopRow}>
              <div
                className={styles.iconCircle}
                style={{
                  background: "rgba(245, 158, 11, 0.16)",
                  color: "#d97706",
                }}
              >
                <CreditCard size={20} color="#d97706" />
              </div>
              <Link href="/analytics" className={styles.actionArrow} aria-label="View AOV">
                <ArrowUpRight size={16} />
              </Link>
            </div>

            <div className={styles.kpiMidLabel}>Average Order Value</div>
            <div className={styles.kpiBigNumber}>{aovBDT > 0 ? cur.format(aovBDT) : "—"}</div>
          </div>

          <div className={styles.kpiBottomRow}>
            <span className={styles.trendMutedText}>Paid orders, all time</span>
          </div>
        </div>

        {/* KPI 5: Net Growth & Margin */}
        <div className={styles.kpiCardLight}>
          <div>
            <div className={styles.kpiTopRow}>
              <div
                className={styles.iconCircle}
                style={{
                  background: "rgba(16, 185, 129, 0.14)",
                  color: "#059669",
                }}
              >
                <Percent size={20} color="#059669" />
              </div>
              <Link href="/analytics" className={styles.actionArrow} aria-label="View profitability">
                <ArrowUpRight size={16} />
              </Link>
            </div>

            <div className={styles.kpiMidLabel}>Gross Margin (30 days)</div>
            <div className={styles.kpiBigNumber}>{marginPercent === null ? "—" : `${marginPercent}%`}</div>
          </div>

          <div className={styles.kpiBottomRow}>
            <span className={styles.trendMutedText}>
              {financials && financials.cogs_estimated_share_pct > 0
                ? `${financials.cogs_estimated_share_pct}% of costs estimated`
                : marginPercent === null
                ? "No revenue in the last 30 days"
                : "From recorded cost prices"}
            </span>
          </div>
        </div>
      </section>

      {/* ======================================================= */}
      {/* TIER 2: MULTI-CHANNEL REVENUE & F-COMMERCE DONUT CHART  */}
      {/* Answers: Where is revenue coming from (Channels & Mix) */}
      {/* ======================================================= */}
      <section className={styles.tierGrid7_5}>
        {/* Widget 1: Revenue by day, from /api/v1/analytics/financials (was a static drawing with invented values) */}
        <div className={styles.whitePanel}>
          <div className={styles.panelHeader}>
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
                <span className={styles.panelTitle}>Revenue, last 30 days</span>
                <span style={{ fontSize: "24px", fontWeight: 700, color: "#111827" }}>
                  {cur.format(financials?.gmv_bdt ?? 0)}
                </span>
              </div>
              <p className={styles.panelSubtitle}>
                {typeof financials?.period_change_pct === "number"
                  ? `${financials.period_change_pct >= 0 ? "+" : ""}${financials.period_change_pct}% vs the previous 30 days`
                  : "No sales in the previous 30 days to compare"}
              </p>
            </div>
          </div>

          {(() => {
            const points: Array<{ date: string; gmv_bdt: number; orders_count: number }> = financials?.time_series ?? [];
            const max = Math.max(1, ...points.map((p) => p.gmv_bdt));
            if (points.length === 0 || points.every((p) => p.gmv_bdt === 0)) {
              return (
                <div style={{ height: "230px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-muted)", fontSize: "13px" }}>
                  No sales in the last 30 days.
                </div>
              );
            }
            return (
              <div style={{ display: "flex", alignItems: "flex-end", gap: "6px", height: "230px", marginTop: "10px" }}>
                {points.map((p) => (
                  <div key={p.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                    <div
                      title={`${p.date}: ${cur.format(p.gmv_bdt)} from ${p.orders_count} orders`}
                      style={{
                        width: "100%",
                        height: `${p.gmv_bdt > 0 ? Math.max(3, Math.round((p.gmv_bdt / max) * 190)) : 0}px`,
                        background: "var(--color-lime-hover)",
                        borderRadius: "6px 6px 0 0",
                      }}
                    />
                    <span style={{ fontSize: "9px", color: "var(--color-text-muted)" }}>{p.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Widget 2: F-Commerce & Social Channel Donut Chart */}
        <div className={styles.whitePanel}>
          <div className={styles.panelHeader}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span className={styles.panelTitle}>F-Commerce Channels</span>
                {selectedChannel && (
                  <span
                    onClick={() => setSelectedChannel(null)}
                    style={{
                      padding: "2px 8px",
                      borderRadius: "10px",
                      background: "rgba(199, 249, 0, 0.25)",
                      color: "#4a5e00",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                    title="Click to reset filter"
                  >
                    {selectedChannel} ✕
                  </span>
                )}
              </div>
              <p className={styles.panelSubtitle}>Social conversation &amp; web revenue share</p>
            </div>
            <Link href="/conversations" style={{ fontSize: "12px", color: "var(--color-text-secondary)", fontWeight: 600 }}>
              Omnichannel →
            </Link>
          </div>

          {/* Interactive Donut Chart Area */}
          <div className={styles.donutInteractiveWrapper}>
            {/* Floating Glassmorphic Hover Tooltip */}
            {hoveredChannel && activeChannel && (
              <div className={styles.donutTooltip}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: activeChannel.color }} />
                    <span style={{ fontWeight: 700, fontSize: "12px", color: "#ffffff" }}>{activeChannel.shortName}</span>
                  </div>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "#C7F900" }}>{activeChannel.sharePercent}%</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px", fontSize: "11px", color: "#d1d5db" }}>
                  <span>Revenue: <strong style={{ color: "#ffffff" }}>{cur.format(activeChannel.revenueBDT)}</strong></span>
                  <span>Orders: <strong style={{ color: "#ffffff" }}>{activeChannel.orders}</strong></span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px", fontSize: "10px", color: "#9ca3af" }}>
                  <span>{activeChannel.agentStatus}</span>
                </div>
              </div>
            )}

            {/* SVG Donut Ring */}
            <div className={styles.donutSvgWrapper}>
              <svg
                viewBox="0 0 200 200"
                style={{ width: "100%", height: "100%", display: "block" }}
              >
                {/* Background Ring Track & Segments (Rotated together around center 100, 100) */}
                <g transform="rotate(-90 100 100)">
                  {/* Background Ring Track */}
                  <circle
                    cx="100"
                    cy="100"
                    r="70"
                    fill="none"
                    stroke="#f1f3f5"
                    strokeWidth="18"
                  />

                  {/* Colored Channel Segments */}
                  {(() => {
                    const r = 70;
                    const circumference = 2 * Math.PI * r;
                    let accumulated = 0;
                    return channelData.map((ch: any) => {
                      const segLen = (ch.sharePercent / 100) * circumference;
                      const strokeDasharray = `${Math.max(0, segLen - 3.5)} ${circumference}`;
                      const strokeDashoffset = -accumulated;
                      accumulated += segLen;

                      const isHovered = hoveredChannel === ch.shortName;
                      const isSelected = selectedChannel === ch.shortName;
                      const isAnyActive = Boolean(hoveredChannel || selectedChannel);
                      const isDimmed = isAnyActive && !isHovered && !isSelected;

                      return (
                        <circle
                          key={ch.id}
                          cx="100"
                          cy="100"
                          r={r}
                          fill="none"
                          stroke={ch.color}
                          strokeWidth={isHovered || isSelected ? 24 : 18}
                          strokeDasharray={strokeDasharray}
                          strokeDashoffset={strokeDashoffset}
                          strokeLinecap="round"
                          className={styles.donutSlice}
                          style={{
                            opacity: isDimmed ? 0.35 : 1,
                            filter: isHovered || isSelected ? `drop-shadow(0 0 6px ${ch.color})` : "none",
                          }}
                          onMouseEnter={() => setHoveredChannel(ch.shortName)}
                          onMouseLeave={() => setHoveredChannel(null)}
                          onClick={() => {
                            setSelectedChannel((prev) => (prev === ch.shortName ? null : ch.shortName));
                          }}
                        />
                      );
                    });
                  })()}
                </g>

                {/* Donut Center Dynamic Content (Unrotated, centered at 100, 100) */}
                {activeChannel ? (
                  <g>
                    <text x="100" y="78" textAnchor="middle" fontSize="12" fontWeight="700" fill={activeChannel.color}>
                      {activeChannel.shortName}
                    </text>
                    <text x="100" y="102" textAnchor="middle" fontSize="19" fontWeight="800" fill="#111827">
                      {cur.format(activeChannel.revenueBDT)}
                    </text>
                    <text x="100" y="119" textAnchor="middle" fontSize="10" fontWeight="600" fill="#4b5563">
                      {activeChannel.orders} Orders ({activeChannel.sharePercent}%)
                    </text>
                    <text x="100" y="133" textAnchor="middle" fontSize="9" fontWeight="600" fill="var(--color-text-secondary)">
                      {activeChannel.agentStatus}
                    </text>
                  </g>
                ) : (
                  <g>
                    <text x="100" y="80" textAnchor="middle" fontSize="10" fontWeight="700" fill="#6b7280" letterSpacing="0.06em">
                      OMNICHANNEL
                    </text>
                    <text x="100" y="104" textAnchor="middle" fontSize="22" fontWeight="800" fill="#111827">
                      {totalOrders.toLocaleString()}
                    </text>
                    <text x="100" y="122" textAnchor="middle" fontSize="11" fontWeight="600" fill="#4b5563">
                      Total Orders
                    </text>
                    <text x="100" y="136" textAnchor="middle" fontSize="9" fontWeight="500" fill="#9ca3af">
                      Hover or click slice
                    </text>
                  </g>
                )}
              </svg>
            </div>

            {/* Click Action Card (Displays only when a slice is clicked) */}
            {selectedChannel && activeChannel && (
              <div className={styles.channelActiveBanner}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "14px" }}>{activeChannel.icon}</span>
                  <div>
                    <div style={{ fontWeight: 700, color: "#111827", fontSize: "12px" }}>
                      {activeChannel.shortName} Selected
                    </div>
                    <div style={{ fontSize: "10px", color: "#6b7280" }}>
                      {activeChannel.orders} orders · {cur.format(activeChannel.revenueBDT)}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <Link href="/conversations">
                    <button
                      type="button"
                      style={{
                        padding: "4px 8px",
                        borderRadius: "8px",
                        background: "#18191c",
                        color: "#ffffff",
                        border: "none",
                        fontSize: "10px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Open Inbox →
                    </button>
                  </Link>
                  <button
                    type="button"
                    onClick={() => setSelectedChannel(null)}
                    style={{
                      padding: "4px 8px",
                      borderRadius: "8px",
                      background: "transparent",
                      border: "1px solid #d1d5db",
                      color: "#374151",
                      fontSize: "10px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#6b7280" }}>
            <span>
              Most orders: <strong>{topChannel && topChannel.orders > 0 ? `${topChannel.shortName} (${topChannel.orders})` : "no orders yet"}</strong>
            </span>
            <span>Paid revenue per channel</span>
          </div>
        </div>
      </section>

      {/* ======================================================= */}
      {/* TIER 3: NEEDS ATTENTION & COMMERCE INTELLIGENCE         */}
      {/* Answers: What Needs Attention -> Why (AI Reasoning)   */}
      {/* ======================================================= */}
      <section className={styles.tierGrid2}>
        {/* 1. VISUAL NEEDS ATTENTION (OPERATIONAL ACTION MATRIX) */}
        <div className={styles.whitePanel} style={{ borderRadius: "20px", padding: "22px" }}>
          <div className={styles.panelHeader} style={{ marginBottom: "16px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span className={styles.panelTitle} style={{ fontSize: "17px", fontWeight: 700 }}>
                  Needs Attention
                </span>
                <span
                  style={{
                    padding: "3px 10px",
                    borderRadius: "12px",
                    background: "rgba(239, 68, 68, 0.12)",
                    color: "#dc2626",
                    fontSize: "11px",
                    fontWeight: 800,
                    letterSpacing: "0.02em",
                  }}
                >
                  {attentionItems.length} to review
                </span>
              </div>
              <p className={styles.panelSubtitle}>From your orders, payments and stock</p>
            </div>

            <Link href="/orders" style={{ fontSize: "12px", color: "var(--color-text-secondary)", fontWeight: 600 }}>
              View Queue →
            </Link>
          </div>

          {/* Visual Attention List */}
          <div className={styles.attentionList}>
            {attentionItems.length === 0 && (
              <div style={{ padding: "18px", color: "var(--color-text-secondary)", fontSize: "13px" }}>Nothing needs attention right now.</div>
            )}
            {attentionItems.map((item) => (
              <div
                key={item.id}
                className={styles.attentionItem}
                style={{ borderLeft: `4px solid ${item.color}` }}
              >
                <div className={styles.attentionLeft}>
                  {/* Big Numeric Badge */}
                  <div
                    className={styles.attentionCountBadge}
                    style={{
                      background: item.color,
                      boxShadow: `0 2px 6px ${item.color}40`,
                    }}
                  >
                    {item.count}
                  </div>

                  <div>
                    <div className={styles.attentionTitleRow}>
                      <span className={styles.attentionTitle}>{item.title}</span>
                    </div>
                    <div className={styles.attentionSubtitle}>{item.subtitle}</div>
                  </div>
                </div>

                <Link href={item.href}>
                  <Button variant="outline" size="sm" style={{ fontSize: "11px", padding: "5px 12px", fontWeight: 700 }}>
                    {item.actionText}
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </div>

        {/* 2. VISUAL COMMERCE INTELLIGENCE (2x2 MICRO-BENTO COCKPIT - WHITE THEME) */}
        <div className={styles.intelligenceCard}>
          <div>
            {/* Header with Live Status */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Sparkles size={18} color="#65a30d" />
                  <span style={{ fontSize: "17px", fontWeight: 700, color: "#111827" }}>
                    Commerce Intelligence
                  </span>
                </div>
                <p style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>
                  Autonomous reasoning, anomaly alerts &amp; growth actions
                </p>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "4px 10px",
                  borderRadius: "10px",
                  background: "rgba(132, 204, 22, 0.12)",
                  border: "1px solid rgba(132, 204, 22, 0.35)",
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#3f6212",
                }}
              >
                {intelligence?.snapshots?.[0]?.source === "SNAPSHOT" ? "Stored analysis" : "Computed now"}
              </div>
            </div>

            {/* Top items from /api/v1/intelligence/overview (were three invented tiles) */}
            <div className={styles.intelligenceGrid}>
              {(() => {
                const tiles = [
                  ...(intelligence?.top_risks ?? []).slice(0, 1).map((r) => ({ tag: "Risk", icon: <AlertTriangle size={12} />, title: r.title, desc: r.recommended_mitigation ?? r.description, href: "/intelligence/insights" })),
                  ...(intelligence?.top_opportunities ?? []).slice(0, 1).map((o) => ({ tag: "Opportunity", icon: <Flame size={12} />, title: o.title, desc: o.description, href: "/intelligence/insights" })),
                  ...(intelligence?.top_recommendations ?? []).slice(0, 1).map((r) => ({ tag: "Recommendation", icon: <Bot size={12} />, title: r.title, desc: r.rationale ?? r.description, href: "/intelligence/recommendations" })),
                ];
                if (tiles.length === 0) {
                  return (
                    <div className={styles.intelligencePod} style={{ gridColumn: "span 2" }}>
                      <div className={styles.podDesc}>No risks, opportunities or recommendations detected from your data yet.</div>
                    </div>
                  );
                }
                return tiles.map((t, i) => (
                  <div key={i} className={styles.intelligencePod} style={i === 2 ? { gridColumn: "span 2" } : undefined}>
                    <div>
                      <div className={styles.podTag}>
                        {t.icon} {t.tag}
                      </div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)", marginTop: "4px" }}>{t.title}</div>
                      <div className={styles.podDesc}>{t.desc}</div>
                    </div>
                    <Link href={t.href} style={{ marginTop: "12px" }}>
                      <button type="button" className={styles.podBtnOutline}>
                        Review
                      </button>
                    </Link>
                  </div>
                ));
              })()}
            </div>
          </div>

          {/* Policy Guardrail Badge */}
          <div className={styles.intelligenceFooter}>
            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <ShieldCheck size={14} color="var(--color-success)" /> Computed from your orders, stock and payments
            </span>
            <Link href="/agents" style={{ color: "#111827", fontWeight: 600 }}>
              Agent Logs →
            </Link>
          </div>
        </div>
      </section>

      {/* ======================================================= */}
      {/* TIER 4: AUTOMATION RUNTIME & BANGLADESH LOGISTICS       */}
      {/* Answers: What can be automated & Regional fulfillment   */}
      {/* ======================================================= */}
      <section className={styles.tierGrid2}>
        {/* Widget 1: Automation & Agent Runtime Activity */}
        <div className={styles.whitePanel}>
          <div className={styles.panelHeader}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Zap size={18} color="#C7F900" />
                <span className={styles.panelTitle}>Automation &amp; Agent Runtime</span>
              </div>
              <p className={styles.panelSubtitle}>Recent AI agent runs</p>
            </div>

            <Link href="/automations">
              <Button variant="outline" size="sm" style={{ fontSize: "11px" }}>
                Manage n8n Workflows
              </Button>
            </Link>
          </div>

          {/* Counts from the recent runs (were literal 14 Online / 2,840 / 99.8% / 2 Actions) */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: "14px" }}>
            {[
              { label: "Recent runs", value: String(agentRuns.length) },
              { label: "Completed", value: String(agentRuns.filter((r) => r.status === "COMPLETED").length) },
              { label: "Awaiting approval", value: String(agentRuns.filter((r) => r.requires_human_approval).length) },
            ].map((stat) => (
              <div key={stat.label} style={{ background: "var(--color-surface-soft)", padding: "10px", borderRadius: "12px", border: "1px solid var(--color-border-subtle)" }}>
                <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>{stat.label}</span>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary)", marginTop: "2px" }}>{stat.value}</div>
              </div>
            ))}
          </div>

          {/* Live Agent Stream */}
          <div className={styles.streamList}>
            {agentStream.length === 0 && (
              <div style={{ padding: "12px", color: "var(--color-text-muted)", fontSize: "12px" }}>No agent runs recorded yet.</div>
            )}
            {agentStream.map((item, idx) => (
              <div key={idx} className={styles.streamItem}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span className={styles.streamPulseDot} />
                  <strong style={{ color: "#111827" }}>{item.agent}:</strong>
                  <span style={{ color: "#4b5563" }}>{item.action}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "10px", color: "#9ca3af" }}>{item.time}</span>
                  <Badge variant="active">{item.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Widget 2: City Orders & Returning Buyer Analysis */}
        <div className={styles.whitePanel}>
          <div className={styles.panelHeader}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <MapPin size={18} color="#0284c7" />
                <span className={styles.panelTitle}>City Orders &amp; Retention</span>
                {selectedCity && (
                  <span
                    onClick={() => setSelectedCity(null)}
                    style={{
                      padding: "2px 8px",
                      borderRadius: "10px",
                      background: "rgba(2, 132, 199, 0.15)",
                      color: "#0284c7",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                    title="Click to clear filter"
                  >
                    {selectedCity} ✕
                  </span>
                )}
              </div>
              <p className={styles.panelSubtitle}>Orders and repeat buyers by division (shipping address)</p>
            </div>

            {/* View Tabs Toggle */}
            <div className={styles.cityTabs}>
              <button
                type="button"
                className={`${styles.cityTabBtn} ${cityViewTab === "orders" ? styles.cityTabBtnActive : ""}`}
                onClick={() => setCityViewTab("orders")}
              >
                City Orders
              </button>
              <button
                type="button"
                className={`${styles.cityTabBtn} ${cityViewTab === "retention" ? styles.cityTabBtnActive : ""}`}
                onClick={() => setCityViewTab("retention")}
              >
                Returning Buyers
              </button>
            </div>
          </div>

          {/* From the store (were literal Dhaka 62% / 72.9% repeat / ৳1,540 / +57%) */}
          <div className={styles.cityKpiStrip}>
            <div className={styles.cityKpiItem}>
              <span style={{ fontSize: "10px", color: "var(--color-text-secondary)", fontWeight: 600 }}>Top division (orders)</span>
              <strong style={{ fontSize: "13px", color: "var(--color-text-primary)", marginTop: "2px" }}>{topCity ? topCity.city : "—"}</strong>
              <span style={{ fontSize: "10px", color: "var(--color-text-secondary)" }}>{topCity ? `${topCity.volumePercent}% (${topCity.orders} orders)` : "No orders yet"}</span>
            </div>
            <div className={styles.cityKpiItem}>
              <span style={{ fontSize: "10px", color: "var(--color-text-secondary)", fontWeight: 600 }}>Returning buyers</span>
              <strong style={{ fontSize: "13px", color: "var(--color-text-primary)", marginTop: "2px" }}>
                {typeof metrics?.returningBuyerPercent === "number" ? `${metrics.returningBuyerPercent}%` : "—"}
              </strong>
              <span style={{ fontSize: "10px", color: "var(--color-text-secondary)" }}>customers with 2+ orders</span>
            </div>
            <div className={styles.cityKpiItem}>
              <span style={{ fontSize: "10px", color: "var(--color-text-secondary)", fontWeight: 600 }}>Average paid order</span>
              <strong style={{ fontSize: "13px", color: "var(--color-text-primary)", marginTop: "2px" }}>{aovBDT > 0 ? cur.format(aovBDT) : "—"}</strong>
              <span style={{ fontSize: "10px", color: "var(--color-text-secondary)" }}>all divisions</span>
            </div>
          </div>

          {/* TAB 1: City Orders Volume View */}
          {cityViewTab === "orders" ? (
            <div className={styles.cityList}>
              {cityAnalysisData.map((item: any, idx: number) => {
                const isSelected = selectedCity === item.city;
                return (
                  <div
                    key={item.id}
                    className={styles.cityListItem}
                    onClick={() => setSelectedCity((prev) => (prev === item.city ? null : item.city))}
                    style={{
                      cursor: "pointer",
                      border: isSelected ? `1px solid ${item.color}` : "1px solid rgba(0, 0, 0, 0.04)",
                      background: isSelected ? "rgba(199, 249, 0, 0.08)" : "#fafafa",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: "115px" }}>
                      <span className={styles.cityRankPill}>#{idx + 1}</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: "12px", color: "#111827" }}>{item.city}</div>

                      </div>
                    </div>

                    {/* Progress Bar Track */}
                    <div style={{ flex: 1, margin: "0 12px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "3px" }}>
                        <span style={{ color: "#6b7280", fontWeight: 500 }}>{item.volumePercent}% volume</span>

                      </div>
                      <div style={{ width: "100%", height: "6px", background: "#f3f4f6", borderRadius: "999px", overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${item.volumePercent}%`,
                            height: "100%",
                            background: item.color,
                            borderRadius: "999px",
                            transition: "width 0.4s ease",
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ textAlign: "right", minWidth: "75px" }}>
                      <div style={{ fontWeight: 700, fontSize: "12px", color: "#111827" }}>
                        {cur.format(item.revenueBDT)}
                      </div>
                      <div style={{ fontSize: "10px", color: "#6b7280" }}>{item.orders} ord</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* TAB 2: Returning Buyers Retention View */
            <div className={styles.cityList}>
              {/* City-by-City Returning Rates */}
              {cityAnalysisData.map((item: any) => (
                <div
                  key={item.id}
                  className={styles.cityListItem}
                  onClick={() => setSelectedCity((prev) => (prev === item.city ? null : item.city))}
                  style={{
                    cursor: "pointer",
                    border: selectedCity === item.city ? `1px solid ${item.color}` : "1px solid rgba(0, 0, 0, 0.04)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: "110px" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: item.color }} />
                    <span style={{ fontWeight: 600, fontSize: "12px", color: "#111827" }}>{item.city}</span>
                  </div>

                  <div style={{ flex: 1, margin: "0 10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "3px" }}>
                      <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>
                        {typeof item.returningBuyerPercent === "number" ? `${item.returningBuyerPercent}% repeat` : "—"}
                      </span>
                      <span style={{ color: "var(--color-text-secondary)", fontSize: "10px" }}>{item.reorderFreq ? `${item.reorderFreq} orders per buyer` : ""}</span>
                    </div>
                    <div style={{ width: "100%", height: "5px", background: "#f3f4f6", borderRadius: "999px", overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${item.returningBuyerPercent ?? 0}%`,
                          height: "100%",
                          background: "#84cc16",
                          borderRadius: "999px",
                        }}
                      />
                    </div>
                  </div>

                </div>
              ))}
            </div>
          )}

          {/* Payment mix from orders (was a literal insight and COD 58% / bKash 30% / Nagad 9%) */}
          <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px solid var(--color-border-subtle)", display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", flexWrap: "wrap" }}>
            <span style={{ color: "var(--color-text-secondary)" }}>Payment mix:</span>
            {(metrics?.paymentMix ?? []).length === 0 && <span style={{ color: "var(--color-text-muted)" }}>no orders yet</span>}
            {(metrics?.paymentMix ?? []).map((m) => (
              <span key={m.method} className={m.method === "COD" ? styles.codPill : m.method === "BKASH" ? styles.bkashPill : styles.nagadPill}>
                {m.method} {m.percent}%
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ======================================================= */}
      {/* TIER 5: CONSOLIDATED OPERATIONS & RECENT ORDERS         */}
      {/* Reduced Inventory Dominance -> Shifted to Operations    */}
      {/* ======================================================= */}
      <section style={{ display: "grid", gridTemplateColumns: "3.8fr 8.2fr", gap: "20px", width: "100%" }}>
        {/* Consolidated Operations Box */}
        <div className={styles.whitePanel}>
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.panelTitle}>Operations &amp; Stock</span>
              <p className={styles.panelSubtitle}>Fulfillment health &amp; warehouse efficiency</p>
            </div>
            <Link href="/inventory" style={{ fontSize: "12px", color: "var(--color-text-secondary)", fontWeight: 600 }}>
              Inventory →
            </Link>
          </div>

          {/* From inventory (were literal 23,340 / 94.8% / 82% / 25 items) */}
          <div className={styles.opsGridCompact}>
            {[
              { label: "Total stock", value: (metrics?.totalStockUnits ?? 0).toLocaleString(), note: "units on hand" },
              { label: "Low stock", value: String(metrics?.lowStockCount ?? 0), note: "SKUs at reorder point" },
              { label: "Products", value: String(metrics?.totalProducts ?? 0), note: "not archived" },
              { label: "Warehouses", value: String(metrics?.warehousesCount ?? 0), note: "configured" },
            ].map((box) => (
              <div key={box.label} className={styles.opsBox}>
                <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>{box.label}</span>
                <strong style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>{box.value}</strong>
                <span style={{ fontSize: "10px", color: "var(--color-text-secondary)" }}>{box.note}</span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: "14px" }}>
            <Link href="/inventory">
              <Button variant="outline" size="sm" fullWidth>
                Manage Warehouses &amp; Stock Transfers →
              </Button>
            </Link>
          </div>
        </div>

        {/* Recent Multi-Channel Orders Table */}
        <div className={styles.whitePanel}>
          <div className={styles.panelHeader}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <span className={styles.panelTitle}>Recent Orders &amp; Inquiries</span>
                {selectedChannel && (
                  <span
                    onClick={() => setSelectedChannel(null)}
                    style={{
                      padding: "2px 8px",
                      borderRadius: "10px",
                      background: "rgba(199, 249, 0, 0.25)",
                      color: "#4a5e00",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                    title="Click to clear channel filter"
                  >
                    Channel: {selectedChannel} ✕
                  </span>
                )}
                {selectedCity && (
                  <span
                    onClick={() => setSelectedCity(null)}
                    style={{
                      padding: "2px 8px",
                      borderRadius: "10px",
                      background: "rgba(2, 132, 199, 0.15)",
                      color: "#0284c7",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                    title="Click to clear city filter"
                  >
                    City: {selectedCity} ✕
                  </span>
                )}
              </div>
              <p className={styles.panelSubtitle}>Your five most recent orders</p>
            </div>
            <Link href="/orders" style={{ fontSize: "12px", color: "var(--color-text-secondary)", fontWeight: 600 }}>
              All Orders →
            </Link>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead>
                <tr style={{ color: "#9ca3af", textAlign: "left", borderBottom: "1px solid #f3f4f6" }}>
                  <th style={{ padding: "8px 6px", fontWeight: 500 }}>Order #</th>
                  <th style={{ padding: "8px 6px", fontWeight: 500 }}>Customer</th>
                  <th style={{ padding: "8px 6px", fontWeight: 500 }}>Channel</th>
                  <th style={{ padding: "8px 6px", fontWeight: 500 }}>Total</th>
                  <th style={{ padding: "8px 6px", fontWeight: 500 }}>Payment</th>
                  <th style={{ padding: "8px 6px", fontWeight: 500 }}>Status</th>
                  <th style={{ padding: "8px 6px", fontWeight: 500, textAlign: "right" }}>Courier</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const displayedOrders = recentOrders.filter((ord: any) => {
                    const matchesChannel = selectedChannel
                      ? ord.channel.toLowerCase() === selectedChannel.toLowerCase()
                      : true;
                    const matchesCity = selectedCity
                      ? ord.city?.toLowerCase() === selectedCity.toLowerCase()
                      : true;
                    return matchesChannel && matchesCity;
                  });

                  if (displayedOrders.length === 0) {
                    return (
                      <tr>
                        <td colSpan={7} style={{ padding: "24px 10px", textAlign: "center", color: "#9ca3af" }}>
                          {recentOrders.length === 0 ? "No orders yet." : "No recent orders match the selected filters."}{" "}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedChannel(null);
                              setSelectedCity(null);
                            }}
                            style={{
                              background: "none",
                              border: "none",
                              color: "#18191c",
                              fontWeight: 700,
                              textDecoration: "underline",
                              cursor: "pointer",
                              marginLeft: "4px",
                            }}
                          >
                            Reset filters
                          </button>
                        </td>
                      </tr>
                    );
                  }

                  return displayedOrders.map((ord: any) => (
                    <tr key={ord.id} style={{ borderBottom: "1px solid #f9fafb" }}>
                      <td style={{ padding: "10px 6px", fontWeight: 700 }}>
                        <Link href="/orders" style={{ color: "#111827", textDecoration: "underline" }}>
                          {ord.id}
                        </Link>
                      </td>
                      <td style={{ padding: "10px 6px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ fontWeight: 600, color: "#111827" }}>{ord.customer}</span>
                          {ord.isReturning ? (
                            <span
                              style={{
                                padding: "1px 5px",
                                borderRadius: "4px",
                                background: "rgba(132, 204, 22, 0.15)",
                                color: "#4d7c0f",
                                fontSize: "9px",
                                fontWeight: 700,
                              }}
                              title="Returning Customer"
                            >
                              REPEAT
                            </span>
                          ) : (
                            <span
                              style={{
                                padding: "1px 5px",
                                borderRadius: "4px",
                                background: "rgba(59, 130, 246, 0.12)",
                                color: "#1d4ed8",
                                fontSize: "9px",
                                fontWeight: 700,
                              }}
                              title="First-Time Customer"
                            >
                              NEW
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: "10px", color: "#9ca3af" }}>
                          {ord.city}
                        </div>
                      </td>
                      <td style={{ padding: "10px 6px" }}>
                        <Badge variant="role">{ord.channel}</Badge>
                      </td>
                      <td style={{ padding: "10px 6px", fontWeight: 700, color: "#111827" }}>
                        {cur.format(ord.amountBDT)}
                      </td>
                      <td style={{ padding: "10px 6px" }}>
                        <Badge variant={ord.payment.includes("PAID") ? "active" : "pending"}>
                          {ord.payment}
                        </Badge>
                      </td>
                      <td style={{ padding: "10px 6px" }}>
                        <Badge
                          variant={
                            ord.status === "DELIVERED"
                              ? "active"
                              : ord.status === "CONFIRMED" || ord.status === "SHIPPED"
                              ? "role"
                              : "pending"
                          }
                        >
                          {ord.status}
                        </Badge>
                      </td>
                      <td style={{ padding: "10px 6px", textAlign: "right", color: "#6b7280" }}>
                        {ord.delivery}
                      </td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
