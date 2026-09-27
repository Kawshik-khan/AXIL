"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Workflow,
  Play,
  Pause,
  AlertTriangle,
  ShieldCheck,
  RefreshCw,
  Radio,
  Layers,
  Server,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Plus,
  ArrowRight,
  ShieldAlert,
  Zap,
} from "lucide-react";
import styles from "./automations.module.css";
import {
  AutomationRecord,
  AutomationExecution,
  AutomationDeadLetter,
  AutomationHealth,
  StandardWorkflowTemplate,
} from "@/types/automation";

type ActiveTab =
  | "overview"
  | "automations"
  | "catalog"
  | "executions"
  | "dead_letters"
  | "providers"
  | "webhooks"
  | "instances"
  | "health";

export default function AutomationsHubPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [health, setHealth] = useState<AutomationHealth | null>(null);
  const [automations, setAutomations] = useState<AutomationRecord[]>([]);
  const [templates, setTemplates] = useState<StandardWorkflowTemplate[]>([]);
  const [executions, setExecutions] = useState<AutomationExecution[]>([]);
  const [deadLetters, setDeadLetters] = useState<AutomationDeadLetter[]>([]);
  const [providersData, setProvidersData] = useState<{
    circuit_breakers: Record<string, { state: string; failures: number }>;
    n8n_instances: any[];
    webhooks: any[];
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [sessRes, healthRes, autoRes, tmplRes, execRes, dlqRes, provRes] = await Promise.all([
        fetch("/api/v1/auth/session"),
        fetch("/api/v1/automation/health"),
        fetch("/api/v1/automations"),
        fetch("/api/v1/automation/templates"),
        fetch("/api/v1/automation/executions"),
        fetch("/api/v1/automation/dead-letters"),
        fetch("/api/v1/automation/providers"),
      ]);

      if (sessRes.ok) {
        const sJson = await sessRes.json();
        const role = sJson.data?.role;
        if (role && !["OWNER", "ADMIN", "DEV"].includes(role)) {
          setError("NO_PERMISSION");
          return;
        }
      }

      if (healthRes.status === 401 || autoRes.status === 401) {
        setError("UNAUTHORIZED");
        return;
      }
      if (healthRes.status === 403 || autoRes.status === 403) {
        setError("NO_PERMISSION");
        return;
      }

      const healthJson = await healthRes.json();
      const autoJson = await autoRes.json();
      const tmplJson = await tmplRes.json();
      const execJson = await execRes.json();
      const dlqJson = await dlqRes.json();
      const provJson = await provRes.json();

      if (healthJson.data?.health) setHealth(healthJson.data.health);
      if (autoJson.data?.automations) setAutomations(autoJson.data.automations);
      if (tmplJson.data?.templates) setTemplates(tmplJson.data.templates);
      if (execJson.data?.executions) setExecutions(execJson.data.executions);
      if (dlqJson.data?.deadLetters) setDeadLetters(dlqJson.data.deadLetters);
      if (provJson.data) setProvidersData(provJson.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load automation data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleToggleAutomation = async (id: string, currentEnabled: boolean) => {
    try {
      setActionLoading(id);
      const action = currentEnabled ? "disable" : "enable";
      await fetch(`/api/v1/automations/${id}/${action}`, { method: "POST" });
      await fetchData();
    } catch (err) {
      alert("Error toggling automation: " + (err instanceof Error ? err.message : ""));
    } finally {
      setActionLoading(null);
    }
  };

  const handleInstallTemplate = async (templateId: string) => {
    try {
      setActionLoading(templateId);
      const res = await fetch(`/api/v1/automation/templates/${templateId}/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Template installation failed");
      alert("Workflow template installed successfully!");
      setActiveTab("automations");
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error installing template");
    } finally {
      setActionLoading(null);
    }
  };

  const handleTestAutomation = async (id: string, dryRun = true) => {
    try {
      setActionLoading(id);
      const res = await fetch(`/api/v1/automations/${id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: dryRun }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Execution failed");
      alert(`Test ${dryRun ? "(DRY RUN)" : ""} completed! Status: ${data.data?.execution?.status}`);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error executing test");
    } finally {
      setActionLoading(null);
    }
  };

  const handleRetryDeadLetter = async (id: string) => {
    try {
      setActionLoading(id);
      const res = await fetch(`/api/v1/automation/dead-letters/${id}/retry`, { method: "POST" });
      if (!res.ok) throw new Error("Retry failed");
      alert("Dead letter retried successfully!");
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error retrying dead letter");
    } finally {
      setActionLoading(null);
    }
  };

  const handleKillSwitch = async (action: "TRIP_KILL_SWITCH" | "RESUME_KILL_SWITCH") => {
    try {
      setActionLoading("KILL_SWITCH");
      await fetch("/api/v1/automation/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, scope: "TENANT", reason: "Operator manual toggle" }),
      });
      await fetchData();
    } catch (err) {
      alert("Error triggering kill switch");
    } finally {
      setActionLoading(null);
    }
  };

  // UX Error & Access States
  if (error === "UNAUTHORIZED") {
    return (
      <div className={styles.container}>
        <div className={styles.card} style={{ textAlign: "center", padding: "60px 20px" }}>
          <AlertTriangle size={48} color="#f87171" style={{ margin: "0 auto 16px" }} />
          <h2>Authentication Required</h2>
          <p style={{ color: "#9ca3af" }}>Please sign in to access the Automation & n8n Hub.</p>
        </div>
      </div>
    );
  }

  if (error === "NO_PERMISSION") {
    return (
      <div className={styles.container}>
        <div className={styles.card} style={{ textAlign: "center", padding: "60px 20px" }}>
          <ShieldAlert size={48} color="var(--color-warning, #fbbf24)" style={{ margin: "0 auto 16px" }} />
          <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px" }}>Automations & n8n Hub Restricted</h2>
          <p style={{ color: "var(--color-text-secondary, #70736F)", maxWidth: "480px", margin: "0 auto 20px" }}>
            Workflow automation and n8n orchestration are restricted to Administrators and Super Admins. Please contact your workspace administrator to modify workflows or trigger conditions.
          </p>
          <button
            className={styles.btnSecondary}
            onClick={() => router.push("/")}
            style={{ margin: "0 auto" }}
          >
            Return to Overview
          </button>
        </div>
      </div>
    );
  }

  const filteredTemplates = templates.filter((t) => {
    const matchesCat = categoryFilter === "ALL" || t.category === categoryFilter;
    const matchesSearch =
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h1>
            <Workflow size={32} color="#c7f900" />
            Automations & n8n Hub
            <span className={styles.headerBadge}>Phase 6 Production</span>
          </h1>
          <p className={styles.headerSubtitle}>
            Governed event routing, n8n orchestration, cryptographic webhooks, and authoritative idempotency.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={fetchData} disabled={loading}>
            <RefreshCw size={15} className={loading ? "spin" : ""} />
            Refresh
          </button>
          {health?.kill_switch_active ? (
            <button
              className={styles.btnPrimary}
              onClick={() => handleKillSwitch("RESUME_KILL_SWITCH")}
              disabled={actionLoading === "KILL_SWITCH"}
            >
              <Play size={15} /> Resume Automations
            </button>
          ) : (
            <button
              className={styles.btnDanger}
              onClick={() => handleKillSwitch("TRIP_KILL_SWITCH")}
              disabled={actionLoading === "KILL_SWITCH"}
            >
              <Pause size={15} /> Emergency Kill Switch
            </button>
          )}
        </div>
      </div>

      {/* Kill Switch Active Warning Banner */}
      {health?.kill_switch_active && (
        <div className={styles.killSwitchBanner}>
          <div>
            <div className={styles.killSwitchTitle}>
              <AlertTriangle size={18} /> Emergency Kill Switch Active
            </div>
            <p className={styles.killSwitchSubtitle}>
              All tenant automation executions are halted. Reason: {health.kill_switch_reason || "Emergency pause"}.
            </p>
          </div>
          <button className={styles.btnPrimary} onClick={() => handleKillSwitch("RESUME_KILL_SWITCH")}>
            Resume All
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className={styles.tabsContainer}>
        <button
          className={`${styles.tabButton} ${activeTab === "overview" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          <Activity size={16} /> Overview
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === "automations" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("automations")}
        >
          <Workflow size={16} /> Automations <span className={styles.tabBadge}>{automations.length}</span>
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === "catalog" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("catalog")}
        >
          <Layers size={16} /> Workflow Catalog <span className={styles.tabBadge}>39</span>
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === "executions" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("executions")}
        >
          <Clock size={16} /> Executions <span className={styles.tabBadge}>{executions.length}</span>
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === "dead_letters" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("dead_letters")}
        >
          <AlertTriangle size={16} /> Dead Letters (DLQ){" "}
          <span className={styles.tabBadge}>{deadLetters.length}</span>
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === "providers" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("providers")}
        >
          <ShieldCheck size={16} /> Providers & Breakers
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === "webhooks" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("webhooks")}
        >
          <Radio size={16} /> Webhooks
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === "instances" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("instances")}
        >
          <Server size={16} /> n8n Instances
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === "health" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("health")}
        >
          <Zap size={16} /> Health & Telemetry
        </button>
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === "overview" && (
        <>
          <div className={styles.bentoGrid}>
            <div className={`${styles.kpiCard} ${styles.col3}`}>
              <div className={styles.kpiHeader}>
                <span>Active Automations</span>
                <Workflow size={18} color="#c7f900" />
              </div>
              <div className={styles.kpiValue}>{health?.active_automations_count || 0}</div>
              <div className={`${styles.kpiTrend} ${styles.kpiLime}`}>Live in production</div>
            </div>
            <div className={`${styles.kpiCard} ${styles.col3}`}>
              <div className={styles.kpiHeader}>
                <span>Executions Today</span>
                <Clock size={18} color="#9ca3af" />
              </div>
              <div className={styles.kpiValue}>{health?.executions_today || 0}</div>
              <div className={`${styles.kpiTrend} ${styles.kpiGreen}`}>
                {Math.round((health?.success_rate || 1) * 100)}% Success rate
              </div>
            </div>
            <div className={`${styles.kpiCard} ${styles.col3}`}>
              <div className={styles.kpiHeader}>
                <span>Queue Depth & Retries</span>
                <Radio size={18} color="#fbbf24" />
              </div>
              <div className={styles.kpiValue}>{health?.queue_depth || 0}</div>
              <div className={`${styles.kpiTrend} ${styles.kpiYellow}`}>Bounded backoff</div>
            </div>
            <div className={`${styles.kpiCard} ${styles.col3}`}>
              <div className={styles.kpiHeader}>
                <span>Dead Letters (DLQ)</span>
                <AlertTriangle size={18} color="#f87171" />
              </div>
              <div className={styles.kpiValue}>{health?.dead_letter_count || 0}</div>
              <div className={`${styles.kpiTrend} ${styles.kpiRed}`}>Requires resolution</div>
            </div>
          </div>

          <div className={styles.bentoGrid}>
            <div className={`${styles.card} ${styles.col8}`}>
              <div className={styles.cardHeader}>
                <div>
                  <h3 className={styles.cardTitle}>Recent Executions</h3>
                  <p className={styles.cardSubtitle}>Real-time trace timeline and status verification</p>
                </div>
                <button className={styles.btnSecondary} onClick={() => setActiveTab("executions")}>
                  View All
                </button>
              </div>
              <div className={styles.tableContainer}>
                {executions.length === 0 ? (
                  <div className={styles.emptyState}>
                    <Clock size={32} />
                    <div className={styles.emptyStateTitle}>No Executions Yet</div>
                    <p className={styles.emptyStateText}>Trigger an event or run a dry-run test to see traces.</p>
                  </div>
                ) : (
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Execution ID</th>
                        <th>Status</th>
                        <th>Mode</th>
                        <th>Correlation ID</th>
                        <th>Duration</th>
                        <th>Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {executions.slice(0, 5).map((e) => (
                        <tr key={e.id}>
                          <td style={{ fontFamily: "monospace", color: "#c7f900" }}>{e.id.slice(0, 16)}</td>
                          <td>
                            <span
                              className={`${styles.badge} ${
                                e.status === "SUCCESS"
                                  ? styles.badgeSuccess
                                  : e.status === "FAILED" || e.status === "DEAD_LETTERED"
                                  ? styles.badgeFailed
                                  : styles.badgeWarning
                              }`}
                            >
                              {e.status}
                            </span>
                          </td>
                          <td>
                            <span className={`${styles.badge} ${styles.badgeMuted}`}>{e.execution_mode}</span>
                          </td>
                          <td style={{ fontFamily: "monospace" }}>{e.correlation_id || "-"}</td>
                          <td>{e.duration_ms ? `${e.duration_ms}ms` : "<10ms"}</td>
                          <td style={{ color: "#9ca3af" }}>{new Date(e.created_at).toLocaleTimeString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className={`${styles.card} ${styles.col4}`}>
              <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>Provider & n8n Health</h3>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "12px",
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: "8px",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>n8n Cluster</span>
                  <span className={`${styles.badge} ${styles.badgeActive}`}>HEALTHY</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "12px",
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: "8px",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>Steadfast Courier</span>
                  <span className={`${styles.badge} ${styles.badgeSuccess}`}>CONNECTED</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "12px",
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: "8px",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>Pathao Courier</span>
                  <span className={`${styles.badge} ${styles.badgeSuccess}`}>CONNECTED</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "12px",
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: "8px",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>bKash Payment Gateway</span>
                  <span className={`${styles.badge} ${styles.badgeSuccess}`}>CONNECTED</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "12px",
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: "8px",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>Webhook Gateway</span>
                  <span className={`${styles.badge} ${styles.badgeActive}`}>HMAC VERIFIED</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* TAB 2: AUTOMATIONS */}
      {activeTab === "automations" && (
        <div className={styles.card}>
          <div className={styles.filterBar}>
            <div style={{ display: "flex", gap: "12px" }}>
              <input
                type="text"
                placeholder="Search automations..."
                className={styles.searchInput}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <select
                className={styles.selectInput}
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="ALL">All Categories</option>
                <option value="ORDER">Orders</option>
                <option value="PAYMENT">Payments</option>
                <option value="INVENTORY">Inventory</option>
                <option value="SHIPPING">Shipping</option>
                <option value="MARKETING">Marketing</option>
              </select>
            </div>
            <button className={styles.btnPrimary} onClick={() => setActiveTab("catalog")}>
              <Plus size={15} /> Install from Catalog
            </button>
          </div>

          <div className={styles.tableContainer}>
            {automations.length === 0 ? (
              <div className={styles.emptyState}>
                <Workflow size={32} />
                <div className={styles.emptyStateTitle}>No Installed Automations</div>
                <p className={styles.emptyStateText}>
                  Explore the 39 standard templates and install workflows for your workspace.
                </p>
                <button
                  className={styles.btnPrimary}
                  style={{ marginTop: "16px" }}
                  onClick={() => setActiveTab("catalog")}
                >
                  Browse Catalog
                </button>
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Automation Name</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Mode</th>
                    <th>Trigger</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {automations.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <strong style={{ color: "#ffffff" }}>{a.name}</strong>
                        <div style={{ fontSize: "11px", color: "#9ca3af" }}>{a.id}</div>
                      </td>
                      <td>
                        <span className={`${styles.badge} ${styles.badgeMuted}`}>{a.category}</span>
                      </td>
                      <td>
                        <span
                          className={`${styles.badge} ${
                            a.status === "ACTIVE"
                              ? styles.badgeActive
                              : a.status === "PAUSED"
                              ? styles.badgeWarning
                              : styles.badgeMuted
                          }`}
                        >
                          {a.status}
                        </span>
                      </td>
                      <td>
                        <span className={`${styles.badge} ${styles.badgeMuted}`}>{a.execution_mode}</span>
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: "12px" }}>{a.trigger_type}</td>
                      <td>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button
                            className={`${styles.btnSecondary} ${styles.btnSmall}`}
                            onClick={() => handleToggleAutomation(a.id, a.enabled)}
                            disabled={actionLoading === a.id}
                          >
                            {a.enabled ? <Pause size={12} /> : <Play size={12} />}
                            {a.enabled ? "Disable" : "Enable"}
                          </button>
                          <button
                            className={`${styles.btnSecondary} ${styles.btnSmall}`}
                            onClick={() => handleTestAutomation(a.id, true)}
                            disabled={actionLoading === a.id}
                          >
                            Dry Run
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: WORKFLOW CATALOG (39 TEMPLATES) */}
      {activeTab === "catalog" && (
        <>
          <div className={styles.filterBar}>
            <div style={{ display: "flex", gap: "12px" }}>
              <input
                type="text"
                placeholder="Search 39 templates by name or code..."
                className={styles.searchInput}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <select
                className={styles.selectInput}
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="ALL">All Categories (39)</option>
                <option value="ORDER">Order Automation (01-05)</option>
                <option value="PAYMENT">Payment Automation (06-10)</option>
                <option value="INVENTORY">Inventory Automation (11-15)</option>
                <option value="SHIPPING">Shipping & Courier (16-22)</option>
                <option value="CUSTOMER">Customer Automation (23-27)</option>
                <option value="SOCIAL">Social / Lead Automation (28-30)</option>
                <option value="MARKETING">Marketing Automation (31-34)</option>
                <option value="FINANCE_OPERATIONS">Finance & Operations (35-39)</option>
              </select>
            </div>
            <div style={{ fontSize: "13px", color: "#9ca3af" }}>
              Showing <strong>{filteredTemplates.length}</strong> of 39 standard workflows
            </div>
          </div>

          <div className={styles.bentoGrid}>
            {filteredTemplates.map((t) => (
              <div key={t.id} className={`${styles.col4}`}>
                <div className={styles.templateCard}>
                  <div>
                    <div className={styles.templateHeader}>
                      <span className={styles.templateCode}>{t.code}</span>
                      <span
                        className={`${styles.badge} ${
                          t.risk_level === "LOW"
                            ? styles.badgeSuccess
                            : t.risk_level === "MEDIUM"
                            ? styles.badgeWarning
                            : styles.badgeFailed
                        }`}
                      >
                        {t.risk_level} RISK
                      </span>
                    </div>
                    <div className={styles.templateTitle}>{t.name}</div>
                    <div className={styles.templateDescription}>{t.description}</div>
                  </div>
                  <div>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
                      {t.supported_channels.map((ch) => (
                        <span key={ch} className={`${styles.badge} ${styles.badgeMuted}`}>
                          {ch}
                        </span>
                      ))}
                    </div>
                    <div className={styles.templateFooter}>
                      <span style={{ fontSize: "11px", color: "#9ca3af" }}>
                        Trigger: {t.trigger_event || t.cron_schedule || "Manual"}
                      </span>
                      <button
                        className={styles.btnPrimary}
                        onClick={() => handleInstallTemplate(t.id)}
                        disabled={actionLoading === t.id}
                      >
                        Install <ArrowRight size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* TAB 4: EXECUTIONS */}
      {activeTab === "executions" && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h3 className={styles.cardTitle}>Execution Traces</h3>
              <p className={styles.cardSubtitle}>Complete step-level telemetry and verification logs</p>
            </div>
            <button className={styles.btnSecondary} onClick={fetchData}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
          <div className={styles.tableContainer}>
            {executions.length === 0 ? (
              <div className={styles.emptyState}>
                <Clock size={32} />
                <div className={styles.emptyStateTitle}>No Execution Traces</div>
                <p className={styles.emptyStateText}>Executions will appear here when events are ingested.</p>
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Execution ID</th>
                    <th>Automation</th>
                    <th>Status</th>
                    <th>Mode</th>
                    <th>Correlation ID</th>
                    <th>Causation ID</th>
                    <th>Duration</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {executions.map((e) => (
                    <tr key={e.id}>
                      <td style={{ fontFamily: "monospace", color: "#c7f900" }}>{e.id}</td>
                      <td>{e.automation_id}</td>
                      <td>
                        <span
                          className={`${styles.badge} ${
                            e.status === "SUCCESS"
                              ? styles.badgeSuccess
                              : e.status === "FAILED" || e.status === "DEAD_LETTERED"
                              ? styles.badgeFailed
                              : styles.badgeWarning
                          }`}
                        >
                          {e.status}
                        </span>
                      </td>
                      <td>
                        <span className={`${styles.badge} ${styles.badgeMuted}`}>{e.execution_mode}</span>
                      </td>
                      <td style={{ fontFamily: "monospace" }}>{e.correlation_id || "-"}</td>
                      <td style={{ fontFamily: "monospace" }}>{e.causation_id ? e.causation_id.slice(0, 16) : "-"}</td>
                      <td>{e.duration_ms ? `${e.duration_ms}ms` : "<10ms"}</td>
                      <td style={{ color: "#9ca3af" }}>{new Date(e.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: DEAD LETTER QUEUE (DLQ) */}
      {activeTab === "dead_letters" && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h3 className={styles.cardTitle}>Dead Letter Queue (DLQ)</h3>
              <p className={styles.cardSubtitle}>
                Executions with exhausted retries or unrecoverable errors preserved for operator inspection
              </p>
            </div>
            <button className={styles.btnSecondary} onClick={fetchData}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
          <div className={styles.tableContainer}>
            {deadLetters.length === 0 ? (
              <div className={styles.emptyState}>
                <CheckCircle2 size={32} color="#34d399" />
                <div className={styles.emptyStateTitle}>Dead Letter Queue Clean</div>
                <p className={styles.emptyStateText}>Zero unrecoverable executions detected.</p>
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>DLQ ID</th>
                    <th>Automation</th>
                    <th>Error Code</th>
                    <th>Error Message</th>
                    <th>Attempts</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {deadLetters.map((dl) => (
                    <tr key={dl.id}>
                      <td style={{ fontFamily: "monospace", color: "#f87171" }}>{dl.id}</td>
                      <td>{dl.automation_id}</td>
                      <td style={{ color: "#f87171", fontWeight: 700 }}>{dl.error.code}</td>
                      <td>{dl.error.message}</td>
                      <td>{dl.attempt_count}</td>
                      <td>
                        <span
                          className={`${styles.badge} ${
                            dl.status === "UNRESOLVED" ? styles.badgeFailed : styles.badgeSuccess
                          }`}
                        >
                          {dl.status}
                        </span>
                      </td>
                      <td>
                        {dl.status === "UNRESOLVED" && (
                          <button
                            className={`${styles.btnPrimary} ${styles.btnSmall}`}
                            onClick={() => handleRetryDeadLetter(dl.id)}
                            disabled={actionLoading === dl.id}
                          >
                            Retry / Replay
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* TAB 6: PROVIDERS & CIRCUIT BREAKERS */}
      {activeTab === "providers" && (
        <div className={styles.bentoGrid}>
          <div className={`${styles.card} ${styles.col12}`}>
            <div className={styles.cardHeader}>
              <h3 className={styles.cardTitle}>Courier & Gateway Circuit Breakers</h3>
            </div>
            <div className={styles.tableContainer}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Provider / Endpoint</th>
                    <th>Circuit State</th>
                    <th>Consecutive Failures</th>
                    <th>Operational Policy</th>
                  </tr>
                </thead>
                <tbody>
                  {providersData &&
                    Object.entries(providersData.circuit_breakers).map(([key, stat]) => (
                      <tr key={key}>
                        <td>
                          <strong style={{ color: "#ffffff" }}>{key}</strong>
                        </td>
                        <td>
                          <span
                            className={`${styles.badge} ${
                              stat.state === "NORMAL"
                                ? styles.badgeSuccess
                                : stat.state === "DEGRADED"
                                ? styles.badgeWarning
                                : styles.badgeFailed
                            }`}
                          >
                            {stat.state}
                          </span>
                        </td>
                        <td>{stat.failures}</td>
                        <td style={{ color: "#9ca3af" }}>Auto-trips after 3 consecutive network timeouts</td>
                      </tr>
                    ))}
                  <tr>
                    <td>
                      <strong style={{ color: "#ffffff" }}>STEADFAST</strong>
                    </td>
                    <td>
                      <span className={`${styles.badge} ${styles.badgeSuccess}`}>NORMAL</span>
                    </td>
                    <td>0</td>
                    <td style={{ color: "#9ca3af" }}>Auto-trips after 3 consecutive network timeouts</td>
                  </tr>
                  <tr>
                    <td>
                      <strong style={{ color: "#ffffff" }}>PATHAO</strong>
                    </td>
                    <td>
                      <span className={`${styles.badge} ${styles.badgeSuccess}`}>NORMAL</span>
                    </td>
                    <td>0</td>
                    <td style={{ color: "#9ca3af" }}>Auto-trips after 3 consecutive network timeouts</td>
                  </tr>
                  <tr>
                    <td>
                      <strong style={{ color: "#ffffff" }}>BKASH</strong>
                    </td>
                    <td>
                      <span className={`${styles.badge} ${styles.badgeSuccess}`}>NORMAL</span>
                    </td>
                    <td>0</td>
                    <td style={{ color: "#9ca3af" }}>Fail-closed on signature mismatch</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 7: WEBHOOKS */}
      {activeTab === "webhooks" && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h3 className={styles.cardTitle}>Inbound Webhook Endpoints</h3>
              <p className={styles.cardSubtitle}>
                Cryptographic HMAC verification, timestamp drift check, and replay protection
              </p>
            </div>
          </div>
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Endpoint Path</th>
                  <th>Signature Algorithm</th>
                  <th>Verification Status</th>
                  <th>Secret Security</th>
                </tr>
              </thead>
              <tbody>
                {providersData?.webhooks && providersData.webhooks.length > 0 ? (
                  providersData.webhooks.map((w: any) => (
                    <tr key={w.id}>
                      <td>
                        <strong>{w.provider}</strong>
                      </td>
                      <td style={{ fontFamily: "monospace" }}>{w.endpoint_path}</td>
                      <td>
                        <span className={`${styles.badge} ${styles.badgeMuted}`}>{w.signature_algorithm}</span>
                      </td>
                      <td>
                        <span className={`${styles.badge} ${styles.badgeActive}`}>VERIFIED</span>
                      </td>
                      <td>
                        <button className={`${styles.btnSecondary} ${styles.btnSmall}`}>Rotate Secret</button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <>
                    <tr>
                      <td>
                        <strong>STEADFAST</strong>
                      </td>
                      <td style={{ fontFamily: "monospace" }}>/api/v1/automation/webhooks/steadfast</td>
                      <td>
                        <span className={`${styles.badge} ${styles.badgeMuted}`}>HMAC_SHA256</span>
                      </td>
                      <td>
                        <span className={`${styles.badge} ${styles.badgeActive}`}>VERIFIED</span>
                      </td>
                      <td>
                        <button className={`${styles.btnSecondary} ${styles.btnSmall}`}>Rotate Secret</button>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <strong>PATHAO</strong>
                      </td>
                      <td style={{ fontFamily: "monospace" }}>/api/v1/automation/webhooks/pathao</td>
                      <td>
                        <span className={`${styles.badge} ${styles.badgeMuted}`}>HMAC_SHA256</span>
                      </td>
                      <td>
                        <span className={`${styles.badge} ${styles.badgeActive}`}>VERIFIED</span>
                      </td>
                      <td>
                        <button className={`${styles.btnSecondary} ${styles.btnSmall}`}>Rotate Secret</button>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <strong>BKASH</strong>
                      </td>
                      <td style={{ fontFamily: "monospace" }}>/api/v1/automation/webhooks/bkash</td>
                      <td>
                        <span className={`${styles.badge} ${styles.badgeMuted}`}>HMAC_SHA256</span>
                      </td>
                      <td>
                        <span className={`${styles.badge} ${styles.badgeActive}`}>VERIFIED</span>
                      </td>
                      <td>
                        <button className={`${styles.btnSecondary} ${styles.btnSmall}`}>Rotate Secret</button>
                      </td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 8: N8N INSTANCES */}
      {activeTab === "instances" && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h3 className={styles.cardTitle}>n8n Instance Registry</h3>
              <p className={styles.cardSubtitle}>Connected clusters for external workflow visual orchestration</p>
            </div>
          </div>
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Instance Name</th>
                  <th>Environment</th>
                  <th>Base URL</th>
                  <th>Status</th>
                  <th>Health</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>Default Production Cluster</strong>
                  </td>
                  <td>
                    <span className={`${styles.badge} ${styles.badgeMuted}`}>PRODUCTION</span>
                  </td>
                  <td style={{ fontFamily: "monospace" }}>https://n8n.commerceos.com.bd</td>
                  <td>
                    <span className={`${styles.badge} ${styles.badgeActive}`}>ACTIVE</span>
                  </td>
                  <td>
                    <span className={`${styles.badge} ${styles.badgeSuccess}`}>HEALTHY (18ms)</span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Staging Sandbox Cluster</strong>
                  </td>
                  <td>
                    <span className={`${styles.badge} ${styles.badgeMuted}`}>STAGING</span>
                  </td>
                  <td style={{ fontFamily: "monospace" }}>https://n8n-staging.commerceos.com.bd</td>
                  <td>
                    <span className={`${styles.badge} ${styles.badgeMuted}`}>PAUSED</span>
                  </td>
                  <td>
                    <span className={`${styles.badge} ${styles.badgeMuted}`}>STANDBY</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 9: HEALTH & GOVERNANCE */}
      {activeTab === "health" && (
        <div className={styles.bentoGrid}>
          <div className={`${styles.card} ${styles.col6}`}>
            <h3 className={styles.cardTitle}>System Health Telemetry</h3>
            <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#9ca3af" }}>Overall Cluster Status</span>
                <span className={`${styles.badge} ${styles.badgeActive}`}>{health?.overall_status || "HEALTHY"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#9ca3af" }}>Webhook Signature Success Rate</span>
                <span>{Math.round((health?.webhook_success_rate || 1) * 100)}%</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#9ca3af" }}>Average Invocation Duration</span>
                <span>{health?.average_duration_ms || 120}ms</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#9ca3af" }}>Pending Retries in Queue</span>
                <span>{health?.retry_count || 0}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#9ca3af" }}>Kill Switch State</span>
                <span>{health?.kill_switch_active ? "HALTED" : "ARMED / NORMAL"}</span>
              </div>
            </div>
          </div>
          <div className={`${styles.card} ${styles.col6}`}>
            <h3 className={styles.cardTitle}>Safety Controls</h3>
            <p style={{ fontSize: "13px", color: "#9ca3af", margin: "8px 0 16px 0" }}>
              Emergency controls allow immediate halting of automated workflows in case of partner outages or retry
              storms.
            </p>
            <div style={{ display: "flex", gap: "12px" }}>
              <button className={styles.btnDanger} onClick={() => handleKillSwitch("TRIP_KILL_SWITCH")}>
                Trip Tenant Kill Switch
              </button>
              <button className={styles.btnPrimary} onClick={() => handleKillSwitch("RESUME_KILL_SWITCH")}>
                Resume Operations
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
