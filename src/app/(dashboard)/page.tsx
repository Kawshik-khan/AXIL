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
    format: (amt) => `$${Math.round(amt / 110).toLocaleString("en-US")}`,
  },
  EUR: {
    code: "EUR",
    symbol: "€",
    name: "Euro (€)",
    rate: 0.92 / 110,
    format: (amt) => `€${Math.round((amt * 0.92) / 110).toLocaleString("de-DE")}`,
  },
  GBP: {
    code: "GBP",
    symbol: "£",
    name: "British Pound (£)",
    rate: 0.79 / 110,
    format: (amt) => `£${Math.round((amt * 0.79) / 110).toLocaleString("en-GB")}`,
  },
};

export default function DashboardPage() {
  const [session, setSession] = useState<any>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Currency state (Bangladesh-first default BDT ৳)
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode>("BDT");
  const [selectedTimeframe, setSelectedTimeframe] = useState<string>("This Month");

  // Interactive Donut Chart state
  const [hoveredChannel, setHoveredChannel] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);

  // City Orders & Returning Buyer Analysis state
  const [cityViewTab, setCityViewTab] = useState<"orders" | "retention">("orders");
  const [selectedCity, setSelectedCity] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const [sessionRes, metricsRes] = await Promise.all([
          fetch("/api/v1/auth/session"),
          fetch("/api/v1/reports/dashboard"),
        ]);

        if (sessionRes.ok) {
          const s = await sessionRes.json();
          setSession(s.data);
          if (s.data?.tenant?.currency && CURRENCIES[s.data.tenant.currency as CurrencyCode]) {
            setSelectedCurrency(s.data.tenant.currency as CurrencyCode);
          }
        }
        if (metricsRes.ok) {
          const m = await metricsRes.json();
          setMetrics(m.data?.metrics || null);
        }
      } catch (err) {
        console.error("Failed to load dashboard telemetry:", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  const cur = CURRENCIES[selectedCurrency];

  // Base metrics from live database
  const baseNetRevenueBDT = metrics?.totalRevenue !== undefined && metrics.totalRevenue > 0 ? metrics.totalRevenue : (metrics?.totalRevenue || 184500);
  const baseTotalOrders = metrics?.totalOrders !== undefined && metrics.totalOrders > 0 ? metrics.totalOrders : (metrics?.totalOrders || 1420);
  const baseActiveCustomers = metrics?.activeCustomers !== undefined ? metrics.activeCustomers : 0;
  const baseAOV = metrics?.averageOrderValue !== undefined && metrics.averageOrderValue > 0 ? metrics.averageOrderValue : 1299;
  const baseMarginPercent = 24.8;

  // Multi-Channel F-Commerce Breakdown (Live from Database)
  const channelData = (metrics?.channelData && metrics.channelData.length > 0) ? metrics.channelData : [
    {
      id: "facebook",
      shortName: "Facebook",
      channel: "Facebook Page & Messenger",
      icon: "💬",
      color: "#1877f2",
      orders: 580,
      sharePercent: 42.5,
      revenueBDT: 78400,
      conversion: "4.8%",
      agentStatus: "Active Listener",
    },
    {
      id: "whatsapp",
      shortName: "WhatsApp",
      channel: "WhatsApp Conversational Cart",
      icon: "🟢",
      color: "#25d366",
      orders: 340,
      sharePercent: 25.0,
      revenueBDT: 46120,
      conversion: "9.2%",
      agentStatus: "Catalog AI Ready",
    },
    {
      id: "instagram",
      shortName: "Instagram",
      channel: "Instagram Direct & Shop",
      icon: "📸",
      color: "#e1306c",
      orders: 210,
      sharePercent: 16.0,
      revenueBDT: 29520,
      conversion: "3.4%",
      agentStatus: "DM Routing",
    },
    {
      id: "website",
      shortName: "Website",
      channel: "Website Storefront",
      icon: "🌐",
      color: "#3b82f6",
      orders: 190,
      sharePercent: 11.0,
      revenueBDT: 20290,
      conversion: "2.1%",
      agentStatus: "Connected",
    },
    {
      id: "manual",
      shortName: "Manual",
      channel: "Manual Phone & Offline",
      icon: "📞",
      color: "#6b7280",
      orders: 100,
      sharePercent: 5.5,
      revenueBDT: 10170,
      conversion: "Manual",
      agentStatus: "Staff Assisted",
    },
  ];

  const activeChannel = channelData.find(
    (c: any) => c.shortName === (hoveredChannel || selectedChannel)
  );

  // City Order Volume & Returning Buyer Analytics (Live from Database)
  const cityAnalysisData = (metrics?.cityAnalysisData && metrics.cityAnalysisData.length > 0) ? metrics.cityAnalysisData : [
    {
      id: "dhaka",
      city: "Dhaka Metro",
      division: "Dhaka",
      orders: 880,
      volumePercent: 62.0,
      revenueBDT: 1143900,
      returningBuyerPercent: 76.4,
      repeatAOV: 1560,
      reorderFreq: "2.8x",
      loyalty: "High Loyalty",
      deliverySLA: "24h SLA",
      growth: "+18.2%",
      color: "#84cc16",
    },
    {
      id: "chattogram",
      city: "Chattogram",
      division: "Chattogram",
      orders: 256,
      volumePercent: 18.0,
      revenueBDT: 332100,
      returningBuyerPercent: 68.2,
      repeatAOV: 1490,
      reorderFreq: "2.3x",
      loyalty: "Growing",
      deliverySLA: "48h SLA",
      growth: "+14.5%",
      color: "#3b82f6",
    },
    {
      id: "sylhet",
      city: "Sylhet",
      division: "Sylhet",
      orders: 142,
      volumePercent: 10.0,
      revenueBDT: 184500,
      returningBuyerPercent: 71.8,
      repeatAOV: 1520,
      reorderFreq: "2.5x",
      loyalty: "High Loyalty",
      deliverySLA: "48h SLA",
      growth: "+9.8%",
      color: "#a855f7",
    },
    {
      id: "rajshahi",
      city: "Rajshahi",
      division: "Rajshahi",
      orders: 78,
      volumePercent: 5.5,
      revenueBDT: 101475,
      returningBuyerPercent: 62.5,
      repeatAOV: 1380,
      reorderFreq: "2.1x",
      loyalty: "Steady",
      deliverySLA: "48h SLA",
      growth: "+11.2%",
      color: "#f59e0b",
    },
    {
      id: "khulna",
      city: "Khulna",
      division: "Khulna",
      orders: 64,
      volumePercent: 4.5,
      revenueBDT: 83025,
      returningBuyerPercent: 58.0,
      repeatAOV: 1340,
      reorderFreq: "1.9x",
      loyalty: "Expanding",
      deliverySLA: "72h SLA",
      growth: "+7.4%",
      color: "#ec4899",
    },
  ];

  // Needs Attention Items
  const attentionItems = [
    {
      id: "att_orders",
      count: "42",
      icon: <Package size={18} color="#ffffff" />,
      color: "#f59e0b",
      title: "Orders Awaiting Courier Booking",
      subtitle: "Confirmed orders pending Pathao / Steadfast parcel generation",
      valueTag: "৳98,400 GMV",
      tagBg: "rgba(245, 158, 11, 0.12)",
      tagColor: "#b45309",
      actionText: "Book Couriers →",
      href: "/orders",
      severity: "urgent",
    },
    {
      id: "att_payments",
      count: "3",
      icon: <CreditCard size={18} color="#ffffff" />,
      color: "#e2136e",
      title: "Unmatched bKash / Nagad TrxIDs",
      subtitle: "Customer payment SMS received awaiting invoice match",
      valueTag: "৳7,500 Pending",
      tagBg: "rgba(226, 19, 110, 0.12)",
      tagColor: "#e2136e",
      actionText: "Verify Payments →",
      href: "/payments",
      severity: "urgent",
    },
    {
      id: "att_courier",
      count: "5",
      icon: <Truck size={18} color="#ffffff" />,
      color: "#ef4444",
      title: "In-Transit Delivery Delays",
      subtitle: "Steadfast reported recipient phone unreachable in Chattogram",
      valueTag: "৳14,200 at Risk",
      tagBg: "rgba(239, 68, 68, 0.12)",
      tagColor: "#dc2626",
      actionText: "Resolve Delays →",
      href: "/shipments",
      severity: "warning",
    },
    {
      id: "att_stock",
      count: "2",
      icon: <Boxes size={18} color="#ffffff" />,
      color: "#84cc16",
      title: "SKUs Below Reorder Threshold",
      subtitle: "Panjabi Cotton-L (4 remaining) & Silk Dupatta (2 remaining)",
      valueTag: "Stockout Alert",
      tagBg: "rgba(132, 204, 22, 0.15)",
      tagColor: "#4d7c0f",
      actionText: "Restock Items →",
      href: "/inventory",
      severity: "warning",
    },
    {
      id: "att_returns",
      count: "4",
      icon: <RotateCcw size={18} color="#ffffff" />,
      color: "#6366f1",
      title: "Return & Exchange Inquiries",
      subtitle: "Size exchange requests from Facebook Messenger",
      valueTag: "Exchange Queue",
      tagBg: "rgba(99, 102, 241, 0.12)",
      tagColor: "#4338ca",
      actionText: "Inspect Returns →",
      href: "/orders",
      severity: "info",
    },
  ];

  // Live Agent Runtime Stream
  const agentStream = [
    {
      time: "Just now",
      agent: "Order Agent",
      action: "Normalized address for Order #1042 (Dhaka Metro → Mirpur-10)",
      status: "Success",
    },
    {
      time: "2m ago",
      agent: "Payment Agent",
      action: "Matched bKash TrxID 9X8123 (৳2,450) via SMS Webhook",
      status: "Verified",
    },
    {
      time: "5m ago",
      agent: "Delivery Agent",
      action: "Booked parcel with Steadfast (Tracking: ST-89210)",
      status: "Dispatched",
    },
    {
      time: "8m ago",
      agent: "Support Agent",
      action: "Resolved Banglish delivery query on WhatsApp in 12s",
      status: "Resolved",
    },
    {
      time: "14m ago",
      agent: "Marketing Agent",
      action: "Sent WhatsApp cart recovery reminder to 18 abandoned sessions",
      status: "Sent",
    },
  ];

  // Recent Orders Feed
  const recentOrders = [
    {
      id: "ORD-1042",
      customer: "Tanvir Ahmed",
      phone: "+880 1712-449102",
      city: "Dhaka Metro",
      isReturning: true,
      channel: "Facebook",
      amountBDT: 2450,
      payment: "bKash · PAID",
      status: "CONFIRMED",
      delivery: "Pathao Express",
    },
    {
      id: "ORD-1041",
      customer: "Sumaiya Islam",
      phone: "+880 1819-338210",
      city: "Chattogram",
      isReturning: true,
      channel: "WhatsApp",
      amountBDT: 3890,
      payment: "COD · PENDING",
      status: "PROCESSING",
      delivery: "Steadfast Courier",
    },
    {
      id: "ORD-1040",
      customer: "Rahim Uddin",
      phone: "+880 1611-998877",
      city: "Sylhet",
      isReturning: false,
      channel: "Website",
      amountBDT: 1200,
      payment: "Nagad · PAID",
      status: "SHIPPED",
      delivery: "RedX Logistics",
    },
    {
      id: "ORD-1039",
      customer: "Farzana Yasmin",
      phone: "+880 1914-776655",
      city: "Dhaka Metro",
      isReturning: true,
      channel: "Instagram",
      amountBDT: 4600,
      payment: "COD · PENDING",
      status: "DELIVERED",
      delivery: "Steadfast Courier",
    },
    {
      id: "ORD-1038",
      customer: "Kamal Hossain",
      phone: "+880 1512-112233",
      city: "Rajshahi",
      isReturning: false,
      channel: "Manual",
      amountBDT: 1850,
      payment: "bKash · PAID",
      status: "DELIVERED",
      delivery: "Pathao Express",
    },
  ];

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
            <div className={styles.kpiBigNumber}>{cur.format(baseNetRevenueBDT)}</div>
          </div>

          <div className={styles.kpiBottomRow}>
            <span className={styles.trendPillGreen}>
              +18.4% <ArrowUpRight size={12} />
            </span>
            <span className={styles.trendMutedText}>vs last month</span>
          </div>
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
            <div className={styles.kpiBigNumber}>{baseTotalOrders.toLocaleString()} Orders</div>
          </div>

          <div className={styles.kpiBottomRow}>
            <span className={styles.trendPillGreen}>
              +12.6% <ArrowUpRight size={12} />
            </span>
            <span className={styles.trendMutedText}>42 awaiting courier</span>
          </div>
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
            <div className={styles.kpiBigNumber}>{baseActiveCustomers.toLocaleString()}</div>
          </div>

          <div className={styles.kpiBottomRow}>
            <span className={styles.trendPillGreen}>
              +8.2% <ArrowUpRight size={12} />
            </span>
            <span className={styles.trendMutedText}>72% repeat buyers</span>
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
            <div className={styles.kpiBigNumber}>{cur.format(baseAOV)}</div>
          </div>

          <div className={styles.kpiBottomRow}>
            <span className={styles.trendPillGreen}>
              +5.4% <ArrowUpRight size={12} />
            </span>
            <span className={styles.trendMutedText}>Strong basket depth</span>
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

            <div className={styles.kpiMidLabel}>Net Operating Margin</div>
            <div className={styles.kpiBigNumber}>{baseMarginPercent}%</div>
          </div>

          <div className={styles.kpiBottomRow}>
            <span className={styles.trendPillGreen}>
              +3.1% <ArrowUpRight size={12} />
            </span>
            <span className={styles.trendMutedText}>Healthy LTV / CAC</span>
          </div>
        </div>
      </section>

      {/* ======================================================= */}
      {/* TIER 2: MULTI-CHANNEL REVENUE & F-COMMERCE DONUT CHART  */}
      {/* Answers: Where is revenue coming from (Channels & Mix) */}
      {/* ======================================================= */}
      <section className={styles.tierGrid7_5}>
        {/* Widget 1: Multi-Channel Revenue Dual Spline Chart */}
        <div className={styles.whitePanel}>
          <div className={styles.panelHeader}>
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
                <span className={styles.panelTitle}>Multi-Channel Revenue</span>
                <span style={{ fontSize: "24px", fontWeight: 700, color: "#111827" }}>
                  {cur.format(baseNetRevenueBDT)}
                </span>
                <span
                  style={{
                    padding: "3px 8px",
                    borderRadius: "12px",
                    background: "rgba(34, 197, 94, 0.12)",
                    color: "#16a34a",
                    fontSize: "11px",
                    fontWeight: 600,
                  }}
                >
                  +18.4% Net Growth
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "16px", marginTop: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#84cc16" }} />
                  <span>Gross Sales ({cur.symbol})</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#bef264" }} />
                  <span>COGS &amp; Courier Cost</span>
                </div>
              </div>
            </div>

            {/* Timeframe Dropdown */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                border: "1px solid rgba(0,0,0,0.1)",
                borderRadius: "12px",
                fontSize: "12px",
                color: "#374151",
                cursor: "pointer",
              }}
            >
              <Calendar size={14} color="#6b7280" />
              <span>{selectedTimeframe}</span>
              <ChevronDown size={14} color="#6b7280" />
            </div>
          </div>

          {/* Spline Chart SVG */}
          <div style={{ position: "relative", width: "100%", height: "230px", marginTop: "10px" }}>
            <svg
              viewBox="0 0 600 220"
              style={{ width: "100%", height: "100%", overflow: "visible" }}
            >
              <defs>
                <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#84cc16" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#84cc16" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Horizontal Grid lines */}
              <line x1="40" y1="30" x2="580" y2="30" stroke="#f3f4f6" strokeDasharray="4 4" />
              <text x="5" y="34" fill="#9ca3af" fontSize="11">200K</text>

              <line x1="40" y1="80" x2="580" y2="80" stroke="#f3f4f6" strokeDasharray="4 4" />
              <text x="5" y="84" fill="#9ca3af" fontSize="11">150K</text>

              <line x1="40" y1="130" x2="580" y2="130" stroke="#f3f4f6" strokeDasharray="4 4" />
              <text x="12" y="134" fill="#9ca3af" fontSize="11">80K</text>

              <line x1="40" y1="180" x2="580" y2="180" stroke="#f3f4f6" strokeDasharray="4 4" />
              <text x="12" y="184" fill="#9ca3af" fontSize="11">20K</text>

              {/* Spline 2: Cost Line (chartreuse) */}
              <path
                d="M 50 145 C 100 130, 140 160, 190 145 C 240 130, 280 115, 330 95 C 380 95, 420 120, 470 125 C 520 130, 550 100, 580 110"
                fill="none"
                stroke="#bef264"
                strokeWidth="2.5"
                strokeLinecap="round"
              />

              {/* Spline 1: Gross Sales Line (lime/green) */}
              <path
                d="M 50 135 C 100 85, 140 110, 190 145 C 240 165, 280 110, 330 65 C 380 75, 420 90, 470 85 C 520 80, 550 45, 580 50"
                fill="none"
                stroke="#84cc16"
                strokeWidth="3"
                strokeLinecap="round"
              />

              {/* Highlight Column on 'Jun' */}
              <line
                x1="330"
                y1="30"
                x2="330"
                y2="185"
                stroke="#a3e635"
                strokeWidth="1.5"
                strokeDasharray="3 3"
              />

              {/* Floating Jun Badges */}
              <g transform="translate(336, 75)">
                <rect x="0" y="0" width="58" height="20" rx="10" fill="#ffffff" stroke="#e5e7eb" strokeWidth="1" />
                <text x="29" y="14" textAnchor="middle" fontSize="10" fontWeight="700" fill="#374151">
                  {cur.format(62000)}
                </text>
              </g>

              <g transform="translate(280, 48)">
                <rect x="0" y="0" width="58" height="20" rx="10" fill="#ffffff" stroke="#84cc16" strokeWidth="1.5" />
                <text x="29" y="14" textAnchor="middle" fontSize="10" fontWeight="700" fill="#111827">
                  {cur.format(184500)}
                </text>
              </g>

              {/* Month Labels */}
              {[
                { m: "Jan", x: 50 },
                { m: "Feb", x: 110 },
                { m: "Mar", x: 170 },
                { m: "Apr", x: 230 },
                { m: "May", x: 280 },
                { m: "Jun", x: 330, active: true },
                { m: "Jul", x: 390 },
                { m: "Aug", x: 450 },
                { m: "Sep", x: 520 },
              ].map((item) => (
                <g key={item.m} transform={`translate(${item.x}, 205)`}>
                  {item.active ? (
                    <>
                      <rect x="-16" y="-12" width="32" height="22" rx="11" fill="#111827" />
                      <text x="0" y="3" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="700">
                        {item.m}
                      </text>
                    </>
                  ) : (
                    <text x="0" y="0" textAnchor="middle" fill="#9ca3af" fontSize="11">
                      {item.m}
                    </text>
                  )}
                </g>
              ))}
            </svg>
          </div>
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
                  <span>Conversion: <strong style={{ color: "#4ade80" }}>{activeChannel.conversion}</strong></span>
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
                    <text x="100" y="133" textAnchor="middle" fontSize="9" fontWeight="600" fill="#16a34a">
                      {activeChannel.conversion} CVR · {activeChannel.agentStatus}
                    </text>
                  </g>
                ) : (
                  <g>
                    <text x="100" y="80" textAnchor="middle" fontSize="10" fontWeight="700" fill="#6b7280" letterSpacing="0.06em">
                      OMNICHANNEL
                    </text>
                    <text x="100" y="104" textAnchor="middle" fontSize="22" fontWeight="800" fill="#111827">
                      1,420
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
                      {activeChannel.orders} orders · {cur.format(activeChannel.revenueBDT)} · {activeChannel.conversion} cvr
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
            <span>Top Performing: <strong>9.2% cvr</strong></span>
            <span style={{ color: "#16a34a", fontWeight: 600 }}>Omnichannel Sync: Live</span>
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
                  5 Actionable
                </span>
              </div>
              <p className={styles.panelSubtitle}>Immediate merchant decisions requiring authorization</p>
            </div>

            <Link href="/orders" style={{ fontSize: "12px", color: "var(--color-text-secondary)", fontWeight: 600 }}>
              View Queue →
            </Link>
          </div>

          {/* Visual Attention List */}
          <div className={styles.attentionList}>
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
                      <span
                        className={styles.attentionValueChip}
                        style={{
                          background: item.tagBg,
                          color: item.tagColor,
                        }}
                      >
                        {item.valueTag}
                      </span>
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
                <span className={styles.streamPulseDot} style={{ background: "#22c55e" }} /> Live Agent
              </div>
            </div>

            {/* 2x2 Micro-Bento Grid */}
            <div className={styles.intelligenceGrid}>
              {/* Tile 1: High Demand Surge */}
              <div
                className={styles.intelligencePod}
                style={{ borderColor: "rgba(234, 88, 12, 0.2)", background: "#fff7ed" }}
              >
                <div>
                  <div className={styles.podTag} style={{ color: "#c2410c" }}>
                    <Flame size={12} /> Demand Spike
                  </div>
                  <div className={styles.podMetric}>+320%</div>
                  <div className={styles.podDesc}>
                    <strong>Panjabi Cotton-L</strong> social inquiries. Projected stockout in 18h.
                  </div>
                </div>

                <Link href="/inventory" style={{ marginTop: "12px" }}>
                  <button type="button" className={styles.podBtnLime}>
                    Approve +50 Units
                  </button>
                </Link>
              </div>

              {/* Tile 2: RTO Anomaly Alert */}
              <div
                className={styles.intelligencePod}
                style={{ borderColor: "rgba(245, 158, 11, 0.25)", background: "#fffbeb" }}
              >
                <div>
                  <div className={styles.podTag} style={{ color: "#b45309" }}>
                    <AlertTriangle size={12} /> Courier Alert
                  </div>
                  <div className={styles.podMetric}>14.2%</div>
                  <div className={styles.podDesc}>
                    Chattogram RTO spiked. Delivery Agent rerouted to Priority Hub.
                  </div>
                </div>

                <Link href="/shipments" style={{ marginTop: "12px" }}>
                  <button type="button" className={styles.podBtnOutline}>
                    Inspect Logistics
                  </button>
                </Link>
              </div>

              {/* Tile 3: WhatsApp Cart Recovery */}
              <div
                className={styles.intelligencePod}
                style={{
                  gridColumn: "span 2",
                  flexDirection: "row",
                  alignItems: "center",
                  borderColor: "rgba(168, 85, 247, 0.2)",
                  background: "#faf5ff",
                  gap: "14px",
                }}
              >
                <div>
                  <div className={styles.podTag} style={{ color: "#7e22ce" }}>
                    <Bot size={12} /> WhatsApp Conversational Recovery
                  </div>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "#111827", marginTop: "3px" }}>
                    {cur.format(38400)}{" "}
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "#15803d", background: "#dcfce7", border: "1px solid rgba(34, 197, 94, 0.3)", padding: "2px 8px", borderRadius: "6px" }}>
                      Recovered Today
                    </span>
                  </div>
                  <div className={styles.podDesc} style={{ marginTop: "3px" }}>
                    Automated Banglish audio nudge converted 18.4% of abandoned checkouts.
                  </div>
                </div>

                <Link href="/growth/journeys" style={{ flexShrink: 0 }}>
                  <button
                    type="button"
                    style={{
                      padding: "8px 14px",
                      borderRadius: "8px",
                      background: "#f3e8ff",
                      color: "#6b21a8",
                      fontSize: "11px",
                      fontWeight: 700,
                      border: "1px solid rgba(168, 85, 247, 0.3)",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    View Journey →
                  </button>
                </Link>
              </div>
            </div>
          </div>

          {/* Policy Guardrail Badge */}
          <div className={styles.intelligenceFooter}>
            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <ShieldCheck size={14} color="#16a34a" /> Deterministic Policy Guardrail Enforced
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
              <p className={styles.panelSubtitle}>14 specialized agents &amp; n8n workflows executing</p>
            </div>

            <Link href="/automations">
              <Button variant="outline" size="sm" style={{ fontSize: "11px" }}>
                Manage n8n Workflows
              </Button>
            </Link>
          </div>

          {/* Quick Stats Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginBottom: "14px" }}>
            <div style={{ background: "#fafafa", padding: "10px", borderRadius: "12px", border: "1px solid #f3f4f6" }}>
              <span style={{ fontSize: "11px", color: "#9ca3af" }}>Active Agents</span>
              <div style={{ fontSize: "16px", fontWeight: 700, color: "#111827", marginTop: "2px" }}>14 Online</div>
            </div>
            <div style={{ background: "#fafafa", padding: "10px", borderRadius: "12px", border: "1px solid #f3f4f6" }}>
              <span style={{ fontSize: "11px", color: "#9ca3af" }}>Events Today</span>
              <div style={{ fontSize: "16px", fontWeight: 700, color: "#111827", marginTop: "2px" }}>2,840</div>
            </div>
            <div style={{ background: "#fafafa", padding: "10px", borderRadius: "12px", border: "1px solid #f3f4f6" }}>
              <span style={{ fontSize: "11px", color: "#9ca3af" }}>Success Rate</span>
              <div style={{ fontSize: "16px", fontWeight: 700, color: "#16a34a", marginTop: "2px" }}>99.8%</div>
            </div>
            <div style={{ background: "#fafafa", padding: "10px", borderRadius: "12px", border: "1px solid #f3f4f6" }}>
              <span style={{ fontSize: "11px", color: "#9ca3af" }}>Pending Approval</span>
              <div style={{ fontSize: "16px", fontWeight: 700, color: "#f59e0b", marginTop: "2px" }}>2 Actions</div>
            </div>
          </div>

          {/* Live Agent Stream */}
          <div className={styles.streamList}>
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
              <p className={styles.panelSubtitle}>Geographic order volume dominance &amp; repeat customer rates</p>
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

          {/* Top Quick Metric Strip */}
          <div className={styles.cityKpiStrip}>
            <div className={styles.cityKpiItem}>
              <span style={{ fontSize: "10px", color: "#6b7280", fontWeight: 600 }}>Top City (Volume)</span>
              <strong style={{ fontSize: "13px", color: "#111827", marginTop: "2px" }}>Dhaka Metro</strong>
              <span style={{ fontSize: "10px", color: "#16a34a" }}>62.0% (880 ord)</span>
            </div>
            <div className={styles.cityKpiItem}>
              <span style={{ fontSize: "10px", color: "#6b7280", fontWeight: 600 }}>Returning Buyer Rate</span>
              <strong style={{ fontSize: "13px", color: "#16a34a", marginTop: "2px" }}>72.9% Repeat</strong>
              <span style={{ fontSize: "10px", color: "#6b7280" }}>2.4x reorder freq</span>
            </div>
            <div className={styles.cityKpiItem}>
              <span style={{ fontSize: "10px", color: "#6b7280", fontWeight: 600 }}>Repeat Buyer AOV</span>
              <strong style={{ fontSize: "13px", color: "#111827", marginTop: "2px" }}>{cur.format(1540)}</strong>
              <span style={{ fontSize: "10px", color: "#2563eb" }}>+57% vs new</span>
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
                        <div style={{ fontSize: "10px", color: "#9ca3af" }}>{item.deliverySLA}</div>
                      </div>
                    </div>

                    {/* Progress Bar Track */}
                    <div style={{ flex: 1, margin: "0 12px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "3px" }}>
                        <span style={{ color: "#6b7280", fontWeight: 500 }}>{item.volumePercent}% volume</span>
                        <span style={{ color: "#16a34a", fontWeight: 600 }}>{item.growth}</span>
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
              {/* Overall Retention Ratio Bar */}
              <div style={{ padding: "8px 10px", background: "#fafafa", borderRadius: "12px", border: "1px solid #f3f4f6", marginBottom: "2px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", fontWeight: 600 }}>
                  <span style={{ color: "#16a34a", display: "flex", alignItems: "center", gap: "4px" }}>
                    <Repeat size={12} /> Returning: 72.9% (1,035 Buyers)
                  </span>
                  <span style={{ color: "#3b82f6" }}>First-Time: 27.1% (385)</span>
                </div>
                <div className={styles.retentionRatioBar}>
                  <div className={styles.retentionBarFill} style={{ width: "72.9%", background: "#84cc16" }} />
                  <div className={styles.retentionBarFill} style={{ width: "27.1%", background: "#93c5fd" }} />
                </div>
              </div>

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
                      <span style={{ fontWeight: 600, color: "#111827" }}>{item.returningBuyerPercent}% Repeat</span>
                      <span style={{ color: "#6b7280", fontSize: "10px" }}>{item.reorderFreq} freq</span>
                    </div>
                    <div style={{ width: "100%", height: "5px", background: "#f3f4f6", borderRadius: "999px", overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${item.returningBuyerPercent}%`,
                          height: "100%",
                          background: "#84cc16",
                          borderRadius: "999px",
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ textAlign: "right", minWidth: "75px" }}>
                    <span
                      style={{
                        padding: "2px 6px",
                        borderRadius: "6px",
                        background:
                          item.returningBuyerPercent > 70
                            ? "rgba(132, 204, 22, 0.15)"
                            : "rgba(59, 130, 246, 0.12)",
                        color: item.returningBuyerPercent > 70 ? "#4d7c0f" : "#1d4ed8",
                        fontSize: "10px",
                        fontWeight: 700,
                      }}
                    >
                      {item.loyalty}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Bottom Card Footer with Insight & Settlement Rails */}
          <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px", flexWrap: "wrap", gap: "6px" }}>
            <span style={{ color: "#4b5563" }}>
              💡 <strong>Retention:</strong> Repeat buyers in Dhaka &amp; Sylhet yield <strong>74% repeat revenue</strong>.
            </span>
            <div style={{ display: "flex", gap: "6px" }}>
              <span className={styles.codPill}>COD 58%</span>
              <span className={styles.bkashPill}>bKash 30%</span>
              <span className={styles.nagadPill}>Nagad 9%</span>
            </div>
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

          <div className={styles.opsGridCompact}>
            <div className={styles.opsBox}>
              <span style={{ fontSize: "11px", color: "#9ca3af" }}>Total Stock</span>
              <strong style={{ fontSize: "14px", color: "#111827" }}>23,340</strong>
              <span style={{ fontSize: "10px", color: "#16a34a" }}>2 Hubs Safe</span>
            </div>

            <div className={styles.opsBox}>
              <span style={{ fontSize: "11px", color: "#9ca3af" }}>Accuracy</span>
              <strong style={{ fontSize: "14px", color: "#111827" }}>94.8%</strong>
              <span style={{ fontSize: "10px", color: "#16a34a" }}>High SLA</span>
            </div>

            <div className={styles.opsBox}>
              <span style={{ fontSize: "11px", color: "#9ca3af" }}>Capacity</span>
              <strong style={{ fontSize: "14px", color: "#111827" }}>82%</strong>
              <span style={{ fontSize: "10px", color: "#6b7280" }}>Optimal</span>
            </div>

            <div className={styles.opsBox}>
              <span style={{ fontSize: "11px", color: "#9ca3af" }}>Dead Stock</span>
              <strong style={{ fontSize: "14px", color: "#111827" }}>25 Items</strong>
              <span style={{ fontSize: "10px", color: "#ef4444" }}>-10% ↘</span>
            </div>
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
              <p className={styles.panelSubtitle}>Live cross-channel order stream with returning buyer indicators</p>
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
                          No recent orders found matching selected filters.{" "}
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
                          {ord.city} · {ord.phone}
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
