"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2,
  TrendingUp,
  AlertTriangle,
  RefreshCw,
  Layers,
  Store,
  ShieldCheck,
  Cpu,
  Bot,
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Clock,
} from "lucide-react";
import styles from "./enterprise.module.css";
import { EnterpriseNav } from "./components/EnterpriseNav";
import { EnterpriseOverview } from "@/types/enterprise";

export default function EnterpriseOverviewPage() {
  const [data, setData] = useState<EnterpriseOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOverview = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/v1/enterprise/overview");
      if (res.status === 401) {
        setError("UNAUTHORIZED");
        return;
      }
      if (res.status === 403) {
        setError("NO_PERMISSION");
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to load enterprise overview");
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error fetching enterprise overview");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchOverview();
  };

  if (loading && !data) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.headerTitleGroup}>
            <h1>
              <Building2 size={28} color="#c7f900" />
              Enterprise Command Center
              <span className={styles.headerBadge}>Phase 9</span>
            </h1>
            <p className={styles.headerSubtitle}>Multi-entity governance, consolidated analytics, and ecosystem operations</p>
          </div>
        </div>
        <EnterpriseNav />
        <div className={styles.emptyState}>
          <RefreshCw className="animate-spin" size={32} color="#c7f900" />
          <p className={styles.emptyStateTitle} style={{ marginTop: 16 }}>Loading enterprise topology...</p>
        </div>
      </div>
    );
  }

  if (error === "UNAUTHORIZED") {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <AlertTriangle size={48} color="#ef4444" />
          <h2 className={styles.emptyStateTitle}>Authentication Required</h2>
          <p>Please log in with valid enterprise session credentials.</p>
        </div>
      </div>
    );
  }

  if (error === "NO_PERMISSION") {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <ShieldCheck size={48} color="#f59e0b" />
          <h2 className={styles.emptyStateTitle}>Access Restricted</h2>
          <p>You do not have permission to view enterprise portfolio operations.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <AlertTriangle size={48} color="#ef4444" />
          <h2 className={styles.emptyStateTitle}>Failed to Load Enterprise Data</h2>
          <p>{error}</p>
          <button className={styles.btnPrimary} onClick={fetchOverview} style={{ marginTop: 16 }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const m = data?.summary_metrics;

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h1>
            <Building2 size={28} color="#c7f900" />
            Enterprise Command Center
            <span className={styles.headerBadge}>Phase 9</span>
          </h1>
          <p className={styles.headerSubtitle}>
            {data?.organization?.name || "Enterprise Organization"} • Multi-Store Governance, Semantic KPIs & Partner Ecosystem
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            <span>Refresh</span>
          </button>
          <Link href="/enterprise/hierarchy" className={styles.btnPrimary}>
            <Store size={14} />
            <span>Manage Stores</span>
          </Link>
        </div>
      </div>

      <EnterpriseNav />

      {/* Primary KPI Bento Grid */}
      <div className={styles.bentoGrid}>
        <div className={`${styles.col3} ${styles.statCard}`}>
          <div className={styles.statLabel}>Consolidated Revenue</div>
          <div className={styles.statValue}>৳{(m?.consolidated_revenue_bdt || 0).toLocaleString()}</div>
          <div className={styles.statMeta}>
            {m?.consolidated_orders ?? 0} orders
          </div>
        </div>

        <div className={`${styles.col3} ${styles.statCard}`}>
          <div className={styles.statLabel}>Blended Gross Margin</div>
          <div className={styles.statValue}>{typeof m?.blended_gross_margin_pct === "number" ? `${m.blended_gross_margin_pct}%` : "—"}</div>
          <div className={styles.statMeta}>From orders and recorded cost prices</div>
        </div>

        <div className={`${styles.col3} ${styles.statCard}`}>
          <div className={styles.statLabel}>Entity Topology</div>
          <div className={styles.statValue}>
            {m?.total_stores || 0} <span style={{ fontSize: 16, color: "#9ca3af" }}>Stores</span>
          </div>
          <div className={styles.statMeta}>
            {m?.total_brands || 0} Brands • {m?.total_business_units || 0} Business Units
          </div>
        </div>

        <div className={`${styles.col3} ${styles.statCard}`}>
          <div className={styles.statLabel}>AI Budget & Quota</div>
          <div className={styles.statValue}>{typeof m?.ai_budget_used_pct === "number" ? `${m.ai_budget_used_pct}%` : "—"}</div>
          <div className={styles.statMeta}>{typeof m?.ai_budget_used_pct === "number" ? "Of this month's AI budget" : "No AI budget set"}</div>
        </div>
      </div>

      {/* Main Grid: Entity Health Matrix & Live Operations */}
      <div className={styles.bentoGrid}>
        {/* Left: Entity Matrix Table (8 cols) */}
        <div className={`${styles.col8} ${styles.card}`}>
          <div className={styles.cardHeader}>
            <div>
              <div className={styles.cardTitle}>
                <Layers size={18} color="#c7f900" />
                Entity Health & Performance Matrix
              </div>
              <div className={styles.cardSubtitle}>Real-time status across multi-brand store network</div>
            </div>
            <Link href="/enterprise/analytics" className={styles.btnSecondary} style={{ fontSize: 12, padding: "6px 12px" }}>
              Deep Dive <ArrowUpRight size={14} />
            </Link>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className={styles.matrixTable}>
              <thead>
                <tr>
                  <th>Store / Entity</th>
                  <th>Type</th>
                  <th>Revenue (BDT)</th>
                  <th>Orders</th>
                  <th>Fulfillment SLA</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data?.entity_health_matrix && data.entity_health_matrix.length > 0 ? (
                  data.entity_health_matrix.map((item) => (
                    <tr key={item.entity_id}>
                      <td style={{ fontWeight: 600, color: "#ffffff" }}>{item.entity_name}</td>
                      <td>
                        <span style={{ fontSize: 11, color: "#9ca3af", background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: 4 }}>
                          {item.entity_type}
                        </span>
                      </td>
                      <td>{typeof item.revenue_bdt === "number" ? `৳${item.revenue_bdt.toLocaleString()}` : "—"}</td>
                      <td>{item.order_count ?? "—"}</td>
                      <td>{typeof item.fulfillment_sla_pct === "number" ? `${item.fulfillment_sla_pct}%` : "—"}</td>
                      <td>
                        <span
                          className={
                            item.status === "HEALTHY"
                              ? styles.badgeHealthy
                              : item.status === "DEGRADED"
                              ? styles.badgeDegraded
                              : styles.badgeCritical
                          }
                        >
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", color: "#9ca3af", padding: 24 }}>
                      No active store entities registered.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Operational Incidents & Connectors (4 cols) */}
        <div className={`${styles.col4} ${styles.card}`}>
          <div className={styles.cardHeader}>
            <div>
              <div className={styles.cardTitle}>
                <AlertTriangle size={18} color="#f59e0b" />
                Active Incidents ({data?.recent_incidents?.length || 0})
              </div>
              <div className={styles.cardSubtitle}>Multi-entity exceptions requiring triage</div>
            </div>
            <Link href="/enterprise/governance" className={styles.btnSecondary} style={{ fontSize: 12, padding: "6px 12px" }}>
              View All
            </Link>
          </div>

          {data?.recent_incidents && data.recent_incidents.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {data.recent_incidents.slice(0, 3).map((inc) => (
                <div
                  key={inc.id}
                  style={{
                    padding: 12,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 10,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: inc.severity === "CRITICAL" ? "#ef4444" : "#f59e0b" }}>
                      {inc.severity} • {inc.domain}
                    </span>
                    <span style={{ fontSize: 11, color: "#9ca3af" }}>{inc.status}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#ffffff", marginBottom: 4 }}>{inc.title}</div>
                  <div style={{ fontSize: 12, color: "#9ca3af" }}>{inc.root_cause || inc.mitigation_plan || "Investigation in progress"}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState} style={{ padding: "24px 0" }}>
              <CheckCircle2 size={32} color="#c7f900" />
              <p className={styles.emptyStateTitle} style={{ marginTop: 8, fontSize: 14 }}>All Systems Healthy</p>
              <p style={{ fontSize: 12 }}>Zero active operational incidents across stores.</p>
            </div>
          )}

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "#9ca3af", display: "flex", alignItems: "center", gap: 6 }}>
                <Cpu size={14} color="#c7f900" /> Connected Integrations
              </span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#ffffff" }}>
                {m?.connected_integrations_count || 0} active
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Grid: Recent Integration Syncs */}
      <div className={styles.bentoGrid}>
        <div className={`${styles.col12} ${styles.card}`}>
          <div className={styles.cardHeader}>
            <div>
              <div className={styles.cardTitle}>
                <Activity size={18} color="#c7f900" />
                Recent Integration Sync Activity
              </div>
              <div className={styles.cardSubtitle}>External ERP, CRM, and marketplace synchronization traces</div>
            </div>
            <Link href="/enterprise/integrations" className={styles.btnSecondary} style={{ fontSize: 12, padding: "6px 12px" }}>
              Integrations Hub <ArrowUpRight size={14} />
            </Link>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className={styles.matrixTable}>
              <thead>
                <tr>
                  <th>Sync ID</th>
                  <th>Integration</th>
                  <th>Entity Type</th>
                  <th>Direction</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Records</th>
                </tr>
              </thead>
              <tbody>
                {data?.recent_syncs && data.recent_syncs.length > 0 ? (
                  data.recent_syncs.map((sync) => (
                    <tr key={sync.id}>
                      <td style={{ fontFamily: "monospace", fontSize: 12, color: "#9ca3af" }}>{sync.id}</td>
                      <td style={{ fontWeight: 600, color: "#ffffff" }}>{sync.integration_id}</td>
                      <td>{sync.entity_type}</td>
                      <td>
                        <span style={{ fontSize: 11, color: "#c7f900" }}>{sync.direction}</span>
                      </td>
                      <td>
                        <span className={sync.status === "COMPLETED" ? styles.badgeHealthy : styles.badgeCritical}>
                          {sync.status}
                        </span>
                      </td>
                      <td>{sync.duration_ms}ms</td>
                      <td>
                        {sync.records_processed} processed • {sync.conflicts_detected} conflicts
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", color: "#9ca3af", padding: 24 }}>
                      No recent sync operations recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
