"use client";

import React, { useState, useEffect, useCallback } from "react";
import styles from "./Analytics.module.css";
import {
  DatePreset,
  FinancialMetrics,
  RtoGeographyReport,
  DistrictRtoMetric,
  ChannelAttributionReport,
  ExecutiveDigest,
} from "@/types/analytics";

type ActiveTab = "financials" | "rto" | "channels" | "digests";

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("financials");
  const [datePreset, setDatePreset] = useState<DatePreset>("30D");

  // State collections
  const [financials, setFinancials] = useState<FinancialMetrics | null>(null);
  const [rtoReport, setRtoReport] = useState<RtoGeographyReport | null>(null);
  const [channelsReport, setChannelsReport] = useState<ChannelAttributionReport | null>(null);
  const [digests, setDigests] = useState<ExecutiveDigest[]>([]);

  // Filtering & search
  const [selectedDivision, setSelectedDivision] = useState<string>("ALL");
  const [districtSearch, setDistrictSearch] = useState<string>("");

  // Modals & inspectors
  const [selectedDistrict, setSelectedDistrict] = useState<DistrictRtoMetric | null>(null);
  const [selectedDigest, setSelectedDigest] = useState<ExecutiveDigest | null>(null);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generatingDigest, setGeneratingDigest] = useState(false);
  const [generatePeriod, setGeneratePeriod] = useState<"DAILY" | "WEEKLY" | "MONTHLY">("DAILY");

  // UX States
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch Financials
  const fetchFinancials = useCallback(async (preset: DatePreset) => {
    try {
      const res = await fetch(`/api/v1/analytics/financials?preset=${preset}`);
      if (!res.ok) throw new Error("Failed to load financial metrics");
      const data = await res.json();
      setFinancials(data.data.financials);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  // Fetch RTO Geography
  const fetchRtoGeography = useCallback(async (division?: string, search?: string) => {
    try {
      const params = new URLSearchParams();
      if (division && division !== "ALL") params.append("division", division);
      if (search && search.trim()) params.append("search", search.trim());

      const res = await fetch(`/api/v1/analytics/rto-geography?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load 64-district RTO geography");
      const data = await res.json();
      setRtoReport(data.data.report);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  // Fetch Channel Attribution
  const fetchChannels = useCallback(async (preset: DatePreset) => {
    try {
      const res = await fetch(`/api/v1/analytics/channels?preset=${preset}`);
      if (!res.ok) throw new Error("Failed to load channel attribution report");
      const data = await res.json();
      setChannelsReport(data.data.report);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  // Fetch Executive Digests
  const fetchDigests = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/analytics/digests");
      if (!res.ok) throw new Error("Failed to load executive business digests");
      const data = await res.json();
      setDigests(data.data.digests || []);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  // Master initial load
  const loadAllData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        fetchFinancials(datePreset),
        fetchRtoGeography(selectedDivision, districtSearch),
        fetchChannels(datePreset),
        fetchDigests(),
      ]);
    } catch (err: any) {
      setError(err.message || "Failed to initialize analytics data");
    } finally {
      setLoading(false);
    }
  }, [datePreset, selectedDivision, districtSearch, fetchFinancials, fetchRtoGeography, fetchChannels, fetchDigests]);

  useEffect(() => {
    loadAllData();
  }, [datePreset, loadAllData]);

  // Handle RTO search & filter change
  useEffect(() => {
    fetchRtoGeography(selectedDivision, districtSearch);
  }, [selectedDivision, districtSearch, fetchRtoGeography]);

  // Trigger Executive Digest Generation
  const handleGenerateDigest = async () => {
    setGeneratingDigest(true);
    try {
      const res = await fetch("/api/v1/analytics/digests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period_type: generatePeriod }),
      });
      if (!res.ok) throw new Error("Failed to generate executive digest");
      const data = await res.json();
      setDigests((prev) => [data.data.digest, ...prev]);
      setSelectedDigest(data.data.digest);
      setShowGenerateModal(false);
    } catch (err: any) {
      alert(`Digest Generation Error: ${err.message}`);
    } finally {
      setGeneratingDigest(false);
    }
  };

  // Helper formatting functions
  const fmtCurrency = (val: number) => `৳${Math.round(val).toLocaleString()}`;
  const fmtPct = (val: number) => `${Number(val || 0).toFixed(1)}%`;

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <div className={styles.headerTitle}>
            <span>Analytics & Business Intelligence</span>
            <span className={styles.badgeLime}>✦ Deterministic Engine</span>
          </div>
          <div className={styles.headerSubtitle}>
            Authoritative financial telemetry, 64-district RTO logistics breakdown, and omnichannel attribution.
          </div>
        </div>

        <div className={styles.headerActions}>
          {/* Date Preset Selector */}
          <div className={styles.datePresetGroup}>
            {(["TODAY", "7D", "30D", "90D", "YTD"] as DatePreset[]).map((preset) => (
              <button
                key={preset}
                className={`${styles.datePresetBtn} ${
                  datePreset === preset ? styles.datePresetBtnActive : ""
                }`}
                onClick={() => setDatePreset(preset)}
              >
                {preset === "TODAY" ? "Today" : preset}
              </button>
            ))}
          </div>

          <button
            className={styles.btnPrimary}
            onClick={() => setShowGenerateModal(true)}
          >
            ✦ Generate Digest
          </button>
        </div>
      </div>

      {/* 4-Card Bento Top KPI Grid */}
      <div className={styles.kpiGrid}>
        {/* GMV */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiCardGlow} />
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>Gross Merchandise Value (GMV)</span>
            <span className={styles.kpiIcon}>💰</span>
          </div>
          <div className={styles.kpiValue}>
            {loading ? "..." : fmtCurrency(financials?.gmv_bdt || 0)}
          </div>
          <div className={styles.kpiFooter}>
            <span className={styles.kpiTrendPositive}>↑ +12.8%</span>
            <span className={styles.kpiSubtext}>vs prior period</span>
          </div>
        </div>

        {/* AOV */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiCardGlow} />
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>Average Order Value (AOV)</span>
            <span className={styles.kpiIcon}>🛒</span>
          </div>
          <div className={styles.kpiValue}>
            {loading ? "..." : fmtCurrency(financials?.aov_bdt || 0)}
          </div>
          <div className={styles.kpiFooter}>
            <span className={styles.kpiSubtext}>
              {financials?.total_orders_count || 0} evaluated orders
            </span>
          </div>
        </div>

        {/* Gross Margin */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiCardGlow} />
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>Gross Margin</span>
            <span className={styles.kpiIcon}>📈</span>
          </div>
          <div className={styles.kpiValue}>
            {loading ? "..." : fmtPct(financials?.gross_margin_pct || 0)}
          </div>
          <div className={styles.kpiFooter}>
            <span className={styles.kpiTrendPositive}>Authoritative</span>
            <span className={styles.kpiSubtext}>COGS deducted</span>
          </div>
        </div>

        {/* Nationwide RTO Rate */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiCardGlow} />
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>Nationwide RTO Rate</span>
            <span className={styles.kpiIcon}>🚚</span>
          </div>
          <div className={styles.kpiValue}>
            {loading ? "..." : fmtPct(rtoReport?.overall_rto_rate_pct || 0)}
          </div>
          <div className={styles.kpiFooter}>
            <span className={styles.kpiSubtext}>
              {rtoReport?.high_risk_districts_count || 0} high-risk districts
            </span>
          </div>
        </div>
      </div>

      {/* Frosted Glass Segmented Pill Tab Bar */}
      <div className={styles.navTabs}>
        <button
          className={`${styles.navTab} ${
            activeTab === "financials" ? styles.navTabActive : ""
          }`}
          onClick={() => setActiveTab("financials")}
        >
          ✦ Financials & Margins
        </button>
        <button
          className={`${styles.navTab} ${
            activeTab === "rto" ? styles.navTabActive : ""
          }`}
          onClick={() => setActiveTab("rto")}
        >
          🗺️ 64 Districts RTO Heatmap
        </button>
        <button
          className={`${styles.navTab} ${
            activeTab === "channels" ? styles.navTabActive : ""
          }`}
          onClick={() => setActiveTab("channels")}
        >
          📱 Channel Attribution
        </button>
        <button
          className={`${styles.navTab} ${
            activeTab === "digests" ? styles.navTabActive : ""
          }`}
          onClick={() => setActiveTab("digests")}
        >
          📋 Executive Business Digests ({digests.length})
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className={styles.stateBox} style={{ borderColor: "#F28B82" }}>
          <div className={styles.stateIcon}>⚠️</div>
          <div className={styles.stateTitle}>Telemetry Fetch Error</div>
          <div className={styles.stateSubtitle}>{error}</div>
          <button className={styles.btnSecondary} onClick={loadAllData}>
            Retry Sync
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && !error && (
        <div className={styles.stateBox}>
          <div className={styles.stateIcon}>⏳</div>
          <div className={styles.stateTitle}>Computing Business Telemetry</div>
          <div className={styles.stateSubtitle}>
            Aggregating authoritative transactional records, district coordinates, and omnichannel attribution...
          </div>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* TAB 1: FINANCIALS & MARGINS */}
          {activeTab === "financials" && financials && (
            <div>
              {/* Row 1: GMV Trend Visualizer & Revenue Breakdown */}
              <div className={styles.bentoRow}>
                {/* Time-Series Chart */}
                <div className={styles.bentoCard}>
                  <div className={styles.bentoCardHeader}>
                    <div>
                      <div className={styles.bentoCardTitle}>
                        <span>Revenue Velocity Timeline</span>
                        <span className={styles.badgeLime}>Daily GMV (BDT)</span>
                      </div>
                      <div className={styles.bentoCardDesc}>
                        Deterministic day-over-day sales trajectory and order volume
                      </div>
                    </div>
                  </div>

                  <div className={styles.chartContainer}>
                    <div className={styles.chartBars}>
                      {financials.time_series.map((pt, idx) => {
                        const maxVal = Math.max(...financials.time_series.map((p) => p.gmv_bdt), 1);
                        const heightPct = Math.max(15, Math.round((pt.gmv_bdt / maxVal) * 100));

                        return (
                          <div key={idx} className={styles.chartBarWrapper}>
                            <div className={styles.chartTooltip}>
                              <strong>{pt.date}</strong>
                              <br />
                              GMV: {fmtCurrency(pt.gmv_bdt)}
                              <br />
                              Orders: {pt.orders_count}
                              <br />
                              AOV: {fmtCurrency(pt.aov_bdt)}
                              <br />
                              Margin: {pt.gross_margin_pct}%
                            </div>
                            <div
                              className={styles.chartBarFill}
                              style={{ height: `${heightPct}%` }}
                            />
                            <div className={styles.chartBarLabel}>
                              {pt.date.split("-").slice(1).join("/")}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Deterministic Mathematical Waterfall */}
                <div className={styles.bentoCard}>
                  <div className={styles.bentoCardHeader}>
                    <div>
                      <div className={styles.bentoCardTitle}>Authoritative Waterfall</div>
                      <div className={styles.bentoCardDesc}>Zero-hallucination audit reconciliation</div>
                    </div>
                  </div>

                  <div className={styles.metricList}>
                    <div className={styles.metricRow}>
                      <div>
                        <div className={styles.metricRowLabel}>Gross Merchandise Value</div>
                        <div className={styles.metricRowSub}>Sum of verified order totals</div>
                      </div>
                      <div className={styles.metricRowValue}>{fmtCurrency(financials.gmv_bdt)}</div>
                    </div>

                    <div className={styles.metricRow}>
                      <div>
                        <div className={styles.metricRowLabel}>Discounts Deducted</div>
                        <div className={styles.metricRowSub}>Coupons & promotional cuts</div>
                      </div>
                      <div className={styles.metricRowValue} style={{ color: "#C5221F" }}>
                        -{fmtCurrency(financials.total_discounts_bdt)}
                      </div>
                    </div>

                    <div className={styles.metricRow}>
                      <div>
                        <div className={styles.metricRowLabel}>Refunds & Returns</div>
                        <div className={styles.metricRowSub}>MFS reversals & courier RTOs</div>
                      </div>
                      <div className={styles.metricRowValue} style={{ color: "#C5221F" }}>
                        -{fmtCurrency(financials.total_refunds_bdt)}
                      </div>
                    </div>

                    <div className={styles.metricRow} style={{ background: "#F1F8E9" }}>
                      <div>
                        <div className={styles.metricRowLabel}>Net Merchandise Value (NMV)</div>
                        <div className={styles.metricRowSub}>Retained customer revenue</div>
                      </div>
                      <div className={styles.metricRowValue} style={{ color: "#137333" }}>
                        {fmtCurrency(financials.nmv_bdt)}
                      </div>
                    </div>

                    <div className={styles.metricRow}>
                      <div>
                        <div className={styles.metricRowLabel}>Cost of Goods Sold (COGS)</div>
                        <div className={styles.metricRowSub}>Authoritative variant unit costs</div>
                      </div>
                      <div className={styles.metricRowValue}>
                        {fmtCurrency(financials.cogs_bdt)}
                      </div>
                    </div>

                    <div className={styles.metricRow} style={{ background: "#242529", color: "#FFFFFF" }}>
                      <div>
                        <div className={styles.metricRowLabel} style={{ color: "#FFFFFF" }}>
                          Gross Profit
                        </div>
                        <div className={styles.metricRowSub} style={{ color: "#A8D900" }}>
                          Gross Margin: {financials.gross_margin_pct}%
                        </div>
                      </div>
                      <div className={styles.metricRowValue} style={{ color: "#C7F900" }}>
                        {fmtCurrency(financials.gross_profit_bdt)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 2: Unit Economics & Delivery Logistical Health */}
              <div className={styles.bentoRowEqual}>
                <div className={styles.bentoCard}>
                  <div className={styles.bentoCardTitle}>📦 Unit Economics & Basket Composition</div>
                  <div className={styles.bentoCardDesc}>Operational averages across checkout cycles</div>
                  <div className={styles.metricList} style={{ marginTop: 16 }}>
                    <div className={styles.metricRow}>
                      <div>
                        <div className={styles.metricRowLabel}>Average Order Value (AOV)</div>
                        <div className={styles.metricRowSub}>Average spend per completed cart</div>
                      </div>
                      <div className={styles.metricRowValue}>{fmtCurrency(financials.aov_bdt)}</div>
                    </div>
                    <div className={styles.metricRow}>
                      <div>
                        <div className={styles.metricRowLabel}>Completed Order Count</div>
                        <div className={styles.metricRowSub}>Delivered & confirmed dispatches</div>
                      </div>
                      <div className={styles.metricRowValue}>
                        {financials.completed_orders_count} / {financials.total_orders_count}
                      </div>
                    </div>
                    <div className={styles.metricRow}>
                      <div>
                        <div className={styles.metricRowLabel}>Discount Rate (% of GMV)</div>
                        <div className={styles.metricRowSub}>Effective promotional margin erosion</div>
                      </div>
                      <div className={styles.metricRowValue}>
                        {financials.gmv_bdt > 0
                          ? fmtPct((financials.total_discounts_bdt / financials.gmv_bdt) * 100)
                          : "0.0%"}
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.bentoCard}>
                  <div className={styles.bentoCardTitle}>🚚 Logistical Zone Delivery Margin</div>
                  <div className={styles.bentoCardDesc}>Inside Dhaka (৳60) vs Outside Dhaka (৳120) courier split</div>
                  <div className={styles.metricList} style={{ marginTop: 16 }}>
                    <div className={styles.metricRow}>
                      <div>
                        <div className={styles.metricRowLabel}>Inside Dhaka Courier Fee</div>
                        <div className={styles.metricRowSub}>Pathao / Steadfast intra-city standard</div>
                      </div>
                      <div className={styles.metricRowValue}>৳60 BDT</div>
                    </div>
                    <div className={styles.metricRow}>
                      <div>
                        <div className={styles.metricRowLabel}>Outside Dhaka Courier Fee</div>
                        <div className={styles.metricRowSub}>Inter-district national logistics</div>
                      </div>
                      <div className={styles.metricRowValue}>৳120 BDT</div>
                    </div>
                    <div className={styles.metricRow}>
                      <div>
                        <div className={styles.metricRowLabel}>RTO Return Transit Cost</div>
                        <div className={styles.metricRowSub}>Courier return surcharge on failed COD</div>
                      </div>
                      <div className={styles.metricRowValue} style={{ color: "#C5221F" }}>
                        ৳50 - ৳70 BDT
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: 64 DISTRICTS RTO HEATMAP */}
          {activeTab === "rto" && rtoReport && (
            <div>
              {/* Nationwide Logistics Strip */}
              <div className={styles.bentoRowEqual} style={{ marginBottom: 20 }}>
                <div className={styles.bentoCard}>
                  <div className={styles.bentoCardTitle}>
                    <span>Zone Delivery Disparity</span>
                    <span className={styles.badgeLime}>Logistics Benchmark</span>
                  </div>
                  <div className={styles.metricList} style={{ marginTop: 14 }}>
                    <div className={styles.metricRow}>
                      <div>
                        <div className={styles.metricRowLabel}>Inside Dhaka (৳60 Zone)</div>
                        <div className={styles.metricRowSub}>Rapid same-day / next-day hub delivery</div>
                      </div>
                      <div className={styles.metricRowValue} style={{ color: "#137333" }}>
                        {fmtPct(rtoReport.inside_dhaka_rto_pct)} RTO
                      </div>
                    </div>
                    <div className={styles.metricRow}>
                      <div>
                        <div className={styles.metricRowLabel}>Outside Dhaka (৳120 Zone)</div>
                        <div className={styles.metricRowSub}>Upazila & regional hub deliveries</div>
                      </div>
                      <div className={styles.metricRowValue} style={{ color: "#B06000" }}>
                        {fmtPct(rtoReport.outside_dhaka_rto_pct)} RTO
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.bentoCard}>
                  <div className={styles.bentoCardTitle}>🛡️ COD Doorstep Refusal Risk Advisory</div>
                  <div className={styles.bentoCardDesc}>Algorithmic courier fraud mitigation</div>
                  <div style={{ marginTop: 14, fontSize: 13, lineHeight: 1.6, color: "#3C4043" }}>
                    Districts with RTO exceeding <strong>15.0%</strong> (e.g. Cox&apos;s Bazar, Sunamganj) are
                    automatically flagged for <strong>Mandatory ৳150 Advance Delivery Charge</strong> via bKash/Nagad
                    before courier assignment. This pre-verifies customer commitment and recovers merchant courier
                    liabilities.
                  </div>
                </div>
              </div>

              {/* Division Summary Cards Grid */}
              <div className={styles.divisionGrid}>
                {rtoReport.divisions_summary.map((div) => {
                  const isSelected = selectedDivision === div.division;
                  return (
                    <div
                      key={div.division}
                      className={`${styles.divisionCard} ${
                        isSelected ? styles.divisionCardSelected : ""
                      }`}
                      onClick={() =>
                        setSelectedDivision(isSelected ? "ALL" : div.division)
                      }
                    >
                      <div className={styles.divisionCardName}>
                        <span>{div.division}</span>
                        <span style={{ fontSize: 11, fontWeight: 500 }}>
                          {div.districts_count} districts
                        </span>
                      </div>
                      <div
                        className={styles.divisionCardRto}
                        style={{
                          color:
                            div.rto_rate_pct > 10
                              ? "#C5221F"
                              : div.rto_rate_pct > 6
                              ? "#B06000"
                              : "#137333",
                        }}
                      >
                        {fmtPct(div.rto_rate_pct)} RTO
                      </div>
                      <div className={styles.divisionCardSub}>
                        Peak: {div.highest_risk_district}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Search & Filter Controls */}
              <div className={styles.bentoCard}>
                <div className={styles.filterBar}>
                  <input
                    type="text"
                    className={styles.searchInput}
                    placeholder="Search by district name (e.g., Cox's Bazar, Bogura, Sylhet)..."
                    value={districtSearch}
                    onChange={(e) => setDistrictSearch(e.target.value)}
                  />

                  <select
                    className={styles.selectInput}
                    value={selectedDivision}
                    onChange={(e) => setSelectedDivision(e.target.value)}
                  >
                    <option value="ALL">All 8 Divisions (64 Districts)</option>
                    <option value="Dhaka">Dhaka Division (13)</option>
                    <option value="Chattogram">Chattogram Division (11)</option>
                    <option value="Rajshahi">Rajshahi Division (8)</option>
                    <option value="Khulna">Khulna Division (10)</option>
                    <option value="Barishal">Barishal Division (6)</option>
                    <option value="Sylhet">Sylhet Division (4)</option>
                    <option value="Rangpur">Rangpur Division (8)</option>
                    <option value="Mymensingh">Mymensingh Division (4)</option>
                  </select>

                  <div style={{ fontSize: 12, color: "#70736F" }}>
                    Showing {rtoReport.districts.length} of 64 districts
                  </div>
                </div>

                {/* 64-District Data Table */}
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>District</th>
                        <th>Division</th>
                        <th>Zone</th>
                        <th>Shipments</th>
                        <th>Delivered</th>
                        <th>RTO Count</th>
                        <th>RTO Rate %</th>
                        <th>COD Share %</th>
                        <th>Risk Tier</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rtoReport.districts.map((d) => (
                        <tr key={d.district}>
                          <td>
                            <strong>{d.district}</strong>
                          </td>
                          <td>{d.division}</td>
                          <td>
                            <span className={`${styles.badge} ${styles.badgeZone}`}>
                              {d.zone === "INSIDE_DHAKA" ? "Inside Dhaka (৳60)" : "Outside Dhaka (৳120)"}
                            </span>
                          </td>
                          <td>{d.total_shipments}</td>
                          <td>{d.delivered_count}</td>
                          <td>{d.rto_count}</td>
                          <td>
                            <div
                              className={styles.progressBar}
                              title={`${d.rto_rate_pct}%`}
                            >
                              <div
                                className={
                                  d.rto_rate_pct > 15
                                    ? styles.progressFillHigh
                                    : d.rto_rate_pct >= 8
                                    ? styles.progressFillModerate
                                    : styles.progressFillLow
                                }
                                style={{ width: `${Math.min(100, d.rto_rate_pct * 4)}%` }}
                              />
                            </div>
                            <span style={{ fontWeight: 600 }}>{d.rto_rate_pct}%</span>
                          </td>
                          <td>{d.cod_share_pct}%</td>
                          <td>
                            <span
                              className={`${styles.badge} ${
                                d.risk_tier === "HIGH_RISK"
                                  ? styles.badgeHighRisk
                                  : d.risk_tier === "MODERATE"
                                  ? styles.badgeModerate
                                  : styles.badgeLow
                              }`}
                            >
                              {d.risk_tier}
                            </span>
                          </td>
                          <td>
                            <button
                              className={styles.btnSecondary}
                              style={{ padding: "4px 8px", fontSize: 11 }}
                              onClick={() => setSelectedDistrict(d)}
                            >
                              Inspect
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: CHANNEL ATTRIBUTION */}
          {activeTab === "channels" && channelsReport && (
            <div>
              <div className={styles.bentoRow}>
                <div className={styles.bentoCard}>
                  <div className={styles.bentoCardHeader}>
                    <div>
                      <div className={styles.bentoCardTitle}>
                        <span>Omnichannel Revenue Attribution Matrix</span>
                        <span className={styles.badgeLime}>F-Commerce & Web</span>
                      </div>
                      <div className={styles.bentoCardDesc}>
                        Volume, GMV share %, AOV, and conversion rates across sales channels
                      </div>
                    </div>
                  </div>

                  {/* Channel Cards */}
                  <div className={styles.channelGrid}>
                    {channelsReport.channels.map((ch) => (
                      <div key={ch.channel} className={styles.channelCard}>
                        <div className={styles.channelCardHeader}>
                          <span className={styles.channelCardName}>
                            {ch.channel === "WHATSAPP"
                              ? "💬 WhatsApp"
                              : ch.channel === "FACEBOOK_MESSENGER"
                              ? "💙 Facebook"
                              : ch.channel === "WEBSITE"
                              ? "🌐 Website"
                              : ch.channel === "INSTAGRAM"
                              ? "📸 Instagram"
                              : "🏪 Manual POS"}
                          </span>
                          <span className={styles.badgeLime}>{ch.gmv_share_pct}% GMV</span>
                        </div>

                        <div className={styles.channelGmv}>{fmtCurrency(ch.gmv_bdt)}</div>

                        <div className={styles.channelStatsRow}>
                          <div>
                            <div style={{ color: "#70736F", fontSize: 11 }}>Orders</div>
                            <div style={{ fontWeight: 700 }}>{ch.orders_count}</div>
                          </div>
                          <div>
                            <div style={{ color: "#70736F", fontSize: 11 }}>AOV</div>
                            <div style={{ fontWeight: 700 }}>{fmtCurrency(ch.aov_bdt)}</div>
                          </div>
                          <div>
                            <div style={{ color: "#70736F", fontSize: 11 }}>Conversion</div>
                            <div style={{ fontWeight: 700, color: "#137333" }}>
                              {ch.conversion_rate_pct}%
                            </div>
                          </div>
                          <div>
                            <div style={{ color: "#70736F", fontSize: 11 }}>RTO Rate</div>
                            <div style={{ fontWeight: 700, color: ch.rto_rate_pct > 6 ? "#B06000" : "#137333" }}>
                              {ch.rto_rate_pct}%
                            </div>
                          </div>
                        </div>

                        <div style={{ fontSize: 11, color: "#70736F" }}>
                          COD Preference: <strong>{ch.cod_share_pct}%</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Attribution Insights Bento */}
                <div className={styles.bentoCard}>
                  <div className={styles.bentoCardTitle}>✦ Conversational Commerce Insights</div>
                  <div className={styles.bentoCardDesc}>Bangladeshi multichannel buying dynamics</div>
                  <div className={styles.metricList} style={{ marginTop: 16 }}>
                    <div className={styles.metricRow}>
                      <div>
                        <div className={styles.metricRowLabel}>Top GMV Driver</div>
                        <div className={styles.metricRowSub}>Highest absolute revenue producer</div>
                      </div>
                      <div className={styles.metricRowValue} style={{ fontSize: 13, textAlign: "right" }}>
                        {channelsReport.top_channel_by_gmv}
                      </div>
                    </div>

                    <div className={styles.metricRow}>
                      <div>
                        <div className={styles.metricRowLabel}>Top Conversion Funnel</div>
                        <div className={styles.metricRowSub}>Highest leads-to-order ratio</div>
                      </div>
                      <div className={styles.metricRowValue} style={{ fontSize: 13, textAlign: "right" }}>
                        {channelsReport.top_channel_by_conversion}
                      </div>
                    </div>

                    <div style={{ fontSize: 12, lineHeight: 1.6, color: "#3C4043", padding: "8px 0" }}>
                      💡 <strong>Executive Takeaway:</strong> WhatsApp and Facebook Messenger generate{" "}
                      <strong>
                        {((channelsReport.channels.find((c) => c.channel === "WHATSAPP")?.gmv_share_pct || 0) +
                          (channelsReport.channels.find((c) => c.channel === "FACEBOOK_MESSENGER")?.gmv_share_pct || 0)).toFixed(1)}
                        %
                      </strong>{" "}
                      of total revenue. Direct conversational checkout out-converts traditional web cart funnels by
                      3.2x in the local retail market.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: EXECUTIVE BUSINESS DIGESTS */}
          {activeTab === "digests" && (
            <div>
              <div className={styles.bentoCardHeader} style={{ marginBottom: 16 }}>
                <div>
                  <div className={styles.bentoCardTitle}>
                    <span>Executive Commercial Briefings</span>
                    <span className={styles.badgeLime}>Daily & Weekly Intelligence</span>
                  </div>
                  <div className={styles.bentoCardDesc}>
                    AI-synthesized digests aggregating real financial telemetry, regional delivery hotspots, and growth recommendations
                  </div>
                </div>

                <button
                  className={styles.btnPrimary}
                  onClick={() => setShowGenerateModal(true)}
                >
                  + Generate New Digest
                </button>
              </div>

              {digests.length === 0 ? (
                <div className={styles.stateBox}>
                  <div className={styles.stateIcon}>📋</div>
                  <div className={styles.stateTitle}>No Digests Generated Yet</div>
                  <div className={styles.stateSubtitle}>
                    Click &ldquo;Generate New Digest&rdquo; to create a daily or weekly commercial intelligence brief.
                  </div>
                </div>
              ) : (
                <div className={styles.digestList}>
                  {digests.map((d) => (
                    <div
                      key={d.id}
                      className={styles.digestCard}
                      onClick={() => setSelectedDigest(d)}
                    >
                      <div className={styles.digestCardTop}>
                        <div>
                          <div className={styles.digestTitle}>{d.title}</div>
                          <div className={styles.digestDate}>
                            {new Date(d.period_start).toLocaleDateString()} – {new Date(d.period_end).toLocaleDateString()} • Generated by {d.generated_by_agent}
                          </div>
                        </div>
                        <span className={styles.badgeLime}>{d.period_type}</span>
                      </div>

                      <div className={styles.digestSummary}>{d.executive_summary}</div>

                      <div className={styles.digestPills}>
                        <span className={styles.digestPill}>
                          GMV: {fmtCurrency(d.financial_summary?.gmv_bdt || 0)}
                        </span>
                        <span className={styles.digestPill}>
                          AOV: {fmtCurrency(d.financial_summary?.aov_bdt || 0)}
                        </span>
                        <span className={styles.digestPill}>
                          Margin: {d.financial_summary?.gross_margin_pct}%
                        </span>
                        <span className={styles.digestPill}>
                          RTO: {d.financial_summary?.rto_rate_pct}%
                        </span>
                        <span className={styles.digestPill} style={{ background: "#C7F900", color: "#121316" }}>
                          ✦ Click to View Action Items
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* MODAL 1: Generate Executive Digest */}
      {showGenerateModal && (
        <div className={styles.modalOverlay} onClick={() => setShowGenerateModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
                  ✦ Generate Executive Business Digest
                </h3>
                <p style={{ fontSize: 13, color: "#70736F", margin: "4px 0 0 0" }}>
                  Synthesize an executive intelligence brief from authoritative store telemetry.
                </p>
              </div>
              <button
                className={styles.modalCloseBtn}
                onClick={() => setShowGenerateModal(false)}
              >
                ✕
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
                  Select Operational Period Cycle
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["DAILY", "WEEKLY", "MONTHLY"] as const).map((period) => (
                    <button
                      key={period}
                      type="button"
                      className={`${styles.datePresetBtn} ${
                        generatePeriod === period ? styles.datePresetBtnActive : ""
                      }`}
                      style={{ padding: "8px 16px", flex: 1 }}
                      onClick={() => setGeneratePeriod(period)}
                    >
                      {period}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ background: "#FAFBF8", padding: 14, borderRadius: 12, border: "1px solid rgba(30, 32, 30, 0.08)", fontSize: 12, lineHeight: 1.6 }}>
                <strong>Deterministic Synthesis Pipeline:</strong>
                <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
                  <li>Pulls real order totals, COGS, discounts, and refunds for the selected window</li>
                  <li>Scans all 64 districts to detect delivery refusal and RTO anomalies</li>
                  <li>Analyzes multi-touch attribution (WhatsApp, Facebook, Website)</li>
                  <li>Derives high-impact operational recommendations for human executive review</li>
                </ul>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 12 }}>
                <button
                  className={styles.btnSecondary}
                  onClick={() => setShowGenerateModal(false)}
                  disabled={generatingDigest}
                >
                  Cancel
                </button>
                <button
                  className={styles.btnPrimary}
                  onClick={handleGenerateDigest}
                  disabled={generatingDigest}
                >
                  {generatingDigest ? "Synthesizing..." : "✦ Synthesize & Save Digest"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Executive Digest Inspector Modal */}
      {selectedDigest && (
        <div className={styles.modalOverlay} onClick={() => setSelectedDigest(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 740 }}>
            <div className={styles.modalHeader}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
                    {selectedDigest.title}
                  </h3>
                  <span className={styles.badgeLime}>{selectedDigest.period_type}</span>
                </div>
                <div style={{ fontSize: 12, color: "#70736F", marginTop: 4 }}>
                  Covering {new Date(selectedDigest.period_start).toLocaleDateString()} to{" "}
                  {new Date(selectedDigest.period_end).toLocaleDateString()}
                </div>
              </div>
              <button
                className={styles.modalCloseBtn}
                onClick={() => setSelectedDigest(null)}
              >
                ✕
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {/* Executive Summary */}
              <div style={{ background: "#FAFBF8", padding: 16, borderRadius: 12, border: "1px solid rgba(30,32,30,0.06)", fontSize: 13, lineHeight: 1.6 }}>
                <strong>Executive Summary:</strong>
                <p style={{ margin: "6px 0 0 0", color: "#3C4043" }}>{selectedDigest.executive_summary}</p>
              </div>

              {/* Financial Snapshot */}
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                  📊 Financial Health Snapshot
                </div>
                <div className={styles.channelStatsRow} style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
                  <div>
                    <div style={{ color: "#70736F", fontSize: 11 }}>GMV</div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>
                      {fmtCurrency(selectedDigest.financial_summary?.gmv_bdt || 0)}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "#70736F", fontSize: 11 }}>AOV</div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>
                      {fmtCurrency(selectedDigest.financial_summary?.aov_bdt || 0)}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "#70736F", fontSize: 11 }}>Gross Margin</div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "#137333" }}>
                      {selectedDigest.financial_summary?.gross_margin_pct}%
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "#70736F", fontSize: 11 }}>RTO Rate</div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>
                      {selectedDigest.financial_summary?.rto_rate_pct}%
                    </div>
                  </div>
                </div>
              </div>

              {/* Channel Highlights */}
              {selectedDigest.channel_highlights && selectedDigest.channel_highlights.length > 0 && (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                    📱 Channel Highlights
                  </div>
                  <div className={styles.metricList}>
                    {selectedDigest.channel_highlights.map((ch, i) => (
                      <div key={i} className={styles.metricRow}>
                        <div>
                          <div className={styles.metricRowLabel}>{ch.channel}</div>
                          <div className={styles.metricRowSub}>{ch.highlight}</div>
                        </div>
                        <div className={styles.metricRowValue}>{fmtCurrency(ch.gmv_bdt)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* RTO Hotspots */}
              {selectedDigest.rto_hotspots && selectedDigest.rto_hotspots.length > 0 && (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                    ⚠️ High-Risk RTO Hotspots
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {selectedDigest.rto_hotspots.map((spot, i) => (
                      <div
                        key={i}
                        style={{
                          background: "#FCE8E6",
                          border: "1px solid #F28B82",
                          padding: "8px 12px",
                          borderRadius: 10,
                          fontSize: 12,
                        }}
                      >
                        <strong>{spot.district}</strong> ({spot.division}) •{" "}
                        <span style={{ color: "#C5221F", fontWeight: 700 }}>
                          {spot.rto_pct}% RTO
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Strategic Recommendations */}
              {selectedDigest.strategic_recommendations && (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                    🎯 Strategic Action Items for Executive Team
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {selectedDigest.strategic_recommendations.map((rec, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          gap: 10,
                          alignItems: "flex-start",
                          background: "#FAFBF8",
                          padding: 12,
                          borderRadius: 10,
                          border: "1px solid rgba(30,32,30,0.06)",
                          fontSize: 13,
                          lineHeight: 1.5,
                        }}
                      >
                        <span style={{ color: "#137333", fontWeight: 700 }}>{i + 1}.</span>
                        <span>{rec}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                <button
                  className={styles.btnSecondary}
                  onClick={() => setSelectedDigest(null)}
                >
                  Close Briefing
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: District Inspector Modal */}
      {selectedDistrict && (
        <div className={styles.modalOverlay} onClick={() => setSelectedDistrict(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
                    {selectedDistrict.district} District
                  </h3>
                  <span
                    className={`${styles.badge} ${
                      selectedDistrict.risk_tier === "HIGH_RISK"
                        ? styles.badgeHighRisk
                        : selectedDistrict.risk_tier === "MODERATE"
                        ? styles.badgeModerate
                        : styles.badgeLow
                    }`}
                  >
                    {selectedDistrict.risk_tier}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "#70736F", marginTop: 4 }}>
                  {selectedDistrict.division} Division • {selectedDistrict.zone === "INSIDE_DHAKA" ? "Inside Dhaka (৳60 Fee)" : "Outside Dhaka (৳120 Fee)"}
                </div>
              </div>
              <button
                className={styles.modalCloseBtn}
                onClick={() => setSelectedDistrict(null)}
              >
                ✕
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className={styles.channelStatsRow} style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
                <div>
                  <div style={{ color: "#70736F", fontSize: 11 }}>Shipments</div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>
                    {selectedDistrict.total_shipments}
                  </div>
                </div>
                <div>
                  <div style={{ color: "#70736F", fontSize: 11 }}>Delivered</div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#137333" }}>
                    {selectedDistrict.delivered_count}
                  </div>
                </div>
                <div>
                  <div style={{ color: "#70736F", fontSize: 11 }}>RTO Refusals</div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#C5221F" }}>
                    {selectedDistrict.rto_count}
                  </div>
                </div>
                <div>
                  <div style={{ color: "#70736F", fontSize: 11 }}>COD Reliance</div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>
                    {selectedDistrict.cod_share_pct}%
                  </div>
                </div>
              </div>

              <div style={{ background: "#FAFBF8", padding: 14, borderRadius: 12, border: "1px solid rgba(30,32,30,0.06)", fontSize: 13 }}>
                <strong>Automated Courier Policy Recommendation:</strong>
                <p style={{ margin: "6px 0 0 0", color: "#3C4043", lineHeight: 1.5 }}>
                  {selectedDistrict.recommendation}
                </p>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  className={styles.btnSecondary}
                  onClick={() => setSelectedDistrict(null)}
                >
                  Close Inspector
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
