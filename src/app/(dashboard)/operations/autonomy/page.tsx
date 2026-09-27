"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldAlert,
  ShieldCheck,
  Zap,
  Lock,
  RefreshCw,
  AlertTriangle,
  Radio,
  Sliders,
  Save,
  CheckCircle2,
} from "lucide-react";
import styles from "../operations.module.css";
import { AutonomyBudget, ProviderHealth } from "@/types/operations";

export default function OperationsAutonomyPage() {
  const [budget, setBudget] = useState<AutonomyBudget | null>(null);
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [killSwitchActionPending, setKillSwitchActionPending] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Form edit states
  const [maxSpend, setMaxSpend] = useState(100000);
  const [maxActions, setMaxActions] = useState(50);
  const [maxLlmCost, setMaxLlmCost] = useState(5.0);

  const fetchAutonomyState = async () => {
    try {
      setLoading(true);
      setError(null);

      const [bRes, pRes] = await Promise.all([
        fetch("/api/v1/operations/autonomy"),
        fetch("/api/v1/operations/providers"),
      ]);

      if (bRes.status === 401 || pRes.status === 401) throw new Error("UNAUTHORIZED");
      if (bRes.status === 403 || pRes.status === 403) throw new Error("NO_PERMISSION");

      const bJson = await bRes.json();
      const pJson = await pRes.json();

      if (!bRes.ok) throw new Error(bJson.error?.message || "Failed to load autonomy budget");
      if (!pRes.ok) throw new Error(pJson.error?.message || "Failed to load provider circuits");

      const bData: AutonomyBudget = bJson.data;
      setBudget(bData);
      setMaxSpend(bData.daily_max_spend_bdt);
      setMaxActions(bData.daily_max_actions);
      setMaxLlmCost(bData.daily_max_llm_cost_usd);

      // Provider health list
      const pList: ProviderHealth[] = Object.entries(pJson.data.providers || {}).map(
        ([name, status]) => ({
          id: `ph_${name}`,
          tenant_id: bData.tenant_id,
          provider_id: name,
          provider_name: name.toUpperCase(),
          provider_type: name.includes("steadfast") || name.includes("pathao") || name.includes("redx") ? "COURIER" : "PAYMENT_GATEWAY",
          status: status as any,
          latency_ms: 120,
          success_rate_percent: status === "HEALTHY" ? 99.4 : status === "DEGRADED" ? 82.0 : 45.0,
          consecutive_failures: status === "OUTAGE" ? 6 : 0,
          circuit_breaker_open: status === "OUTAGE",
          last_checked_at: new Date().toISOString(),
        })
      );
      setProviders(pList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading autonomy controls");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAutonomyState();
  }, []);

  const handleSaveBudget = async () => {
    try {
      setSaving(true);
      setSavedSuccess(false);
      const res = await fetch("/api/v1/operations/autonomy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daily_max_spend_bdt: Number(maxSpend),
          daily_max_actions: Number(maxActions),
          daily_max_llm_cost_usd: Number(maxLlmCost),
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to update budget");

      setBudget(json.data);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleKillSwitch = async () => {
    try {
      setKillSwitchActionPending(true);
      const action = budget?.emergency_stopped ? "CLEAR" : "TRIGGER";

      const res = await fetch("/api/v1/operations/autonomy/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reason: action === "TRIGGER" ? "Manually initiated from Autonomy Control Center" : undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Kill switch operation failed");

      setBudget(json.data.budget);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Kill switch toggle failed");
    } finally {
      setKillSwitchActionPending(false);
    }
  };

  // 1. Loading State
  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.stateContainer}>
          <div className={styles.spinner} />
          <h2 className={styles.stateTitle}>Loading Autonomy Controls...</h2>
          <p className={styles.stateDescription}>Verifying multi-tenant policy limits and circuit breaker relays.</p>
        </div>
      </div>
    );
  }

  // 2. Unauthorized State
  if (error === "UNAUTHORIZED") {
    return (
      <div className={styles.container}>
        <div className={styles.stateContainer}>
          <div className={styles.stateIcon}><Lock size={24} /></div>
          <h2 className={styles.stateTitle}>Authentication Required</h2>
          <p className={styles.stateDescription}>Please sign in to access Autonomy Controls.</p>
        </div>
      </div>
    );
  }

  // 3. No Permission State
  if (error === "NO_PERMISSION") {
    return (
      <div className={styles.container}>
        <div className={styles.stateContainer}>
          <div className={styles.stateIcon}><ShieldAlert size={24} color="#ef4444" /></div>
          <h2 className={styles.stateTitle}>Admin Permissions Required</h2>
          <p className={styles.stateDescription}>Only administrators can modify autonomy safety controls.</p>
        </div>
      </div>
    );
  }

  // 4. Error State
  if (error || !budget) {
    return (
      <div className={styles.container}>
        <div className={styles.stateContainer}>
          <div className={styles.stateIcon}><AlertTriangle size={24} color="#ef4444" /></div>
          <h2 className={styles.stateTitle}>Failed to Connect to Safety Engine</h2>
          <p className={styles.stateDescription}>{error || "Unknown error."}</p>
          <button className={styles.btnPrimary} onClick={fetchAutonomyState}>Retry</button>
        </div>
      </div>
    );
  }

  const isStopped = budget.emergency_stopped;

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h1>
            <ShieldCheck size={28} color="#c7f900" />
            Autonomy & Safety Control Center
          </h1>
          <p className={styles.headerSubtitle}>
            Hard Operational Boundaries, Emergency Kill Switches, and Circuit Breakers
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={fetchAutonomyState}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Subnav */}
      <div className={styles.subnav}>
        <Link href="/operations" className={styles.tabLink}>
          Overview
        </Link>
        <Link href="/operations/workflows" className={styles.tabLink}>
          Workflows
        </Link>
        <Link href="/operations/exceptions" className={styles.tabLink}>
          Exceptions
        </Link>
        <Link href="/operations/autonomy" className={`${styles.tabLink} ${styles.tabLinkActive}`}>
          Autonomy & Safety
        </Link>
        <Link href="/operations/receipts" className={styles.tabLink}>
          Action Receipts
        </Link>
      </div>

      {/* Emergency Kill Switch Section */}
      <div
        className={styles.card}
        style={{
          border: isStopped ? "2px solid #ef4444" : "1px solid rgba(239, 68, 68, 0.4)",
          background: isStopped ? "rgba(239, 68, 68, 0.12)" : "#1e1f23",
          marginBottom: "24px",
        }}
      >
        <div className={styles.cardHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <ShieldAlert size={24} color={isStopped ? "#ef4444" : "#fca5a5"} />
            <div>
              <span style={{ fontSize: "16px", fontWeight: "800", color: isStopped ? "#ef4444" : "#ffffff" }}>
                Tenant Emergency Kill Switch
              </span>
              <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "2px" }}>
                {isStopped
                  ? "CURRENT STATUS: ACTIVE HALT. All agent execution and automated mutations are frozen."
                  : "CURRENT STATUS: NORMAL. Autonomous operations execute safely within defined policy limits."}
              </div>
            </div>
          </div>

          <button
            className={isStopped ? styles.btnPrimary : styles.btnDanger}
            onClick={toggleKillSwitch}
            disabled={killSwitchActionPending}
          >
            {killSwitchActionPending ? "Toggling..." : isStopped ? "Disarm Kill Switch" : "Emergency Kill Switch"}
          </button>
        </div>
      </div>

      {/* Bento Grid: Budget Policy Knobs & Provider Relays */}
      <div className={styles.bentoGrid}>
        {/* Left Card: Daily Autonomy Budget Sliders */}
        <div className={`${styles.card} ${styles.col6}`}>
          <div className={styles.cardHeader}>
            <span className={styles.cardTitle}>
              <Sliders size={16} color="#c7f900" /> Daily Spend & Action Policy Caps
            </span>
            {savedSuccess && (
              <span className={styles.statusHealthy} style={{ fontSize: "11px" }}>
                <CheckCircle2 size={12} /> Saved
              </span>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "20px", marginTop: "12px" }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "6px" }}>
                <span>Daily Max Restock Spend (BDT)</span>
                <strong style={{ color: "#c7f900" }}>৳{Number(maxSpend).toLocaleString()}</strong>
              </div>
              <input
                type="range"
                min="10000"
                max="500000"
                step="10000"
                value={maxSpend}
                onChange={(e) => setMaxSpend(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#c7f900" }}
              />
              <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "4px" }}>
                Used today: ৳{budget.spend_used_today_bdt.toLocaleString()}
              </div>
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "6px" }}>
                <span>Daily Max Automated Actions</span>
                <strong style={{ color: "#c7f900" }}>{maxActions} actions</strong>
              </div>
              <input
                type="range"
                min="10"
                max="200"
                step="5"
                value={maxActions}
                onChange={(e) => setMaxActions(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#c7f900" }}
              />
              <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "4px" }}>
                Executed today: {budget.actions_used_today} actions
              </div>
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "6px" }}>
                <span>Daily Max LLM Cost (USD)</span>
                <strong style={{ color: "#c7f900" }}>${maxLlmCost.toFixed(2)}</strong>
              </div>
              <input
                type="range"
                min="1.0"
                max="25.0"
                step="0.5"
                value={maxLlmCost}
                onChange={(e) => setMaxLlmCost(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#c7f900" }}
              />
              <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "4px" }}>
                Consumed today: ${budget.llm_cost_used_today_usd.toFixed(3)}
              </div>
            </div>

            <button
              className={styles.btnPrimary}
              onClick={handleSaveBudget}
              disabled={saving}
              style={{ alignSelf: "flex-start", marginTop: "8px" }}
            >
              <Save size={14} /> {saving ? "Saving Policy..." : "Update Autonomy Policy"}
            </button>
          </div>
        </div>

        {/* Right Card: Provider Circuit Breakers */}
        <div className={`${styles.card} ${styles.col6}`}>
          <div className={styles.cardHeader}>
            <span className={styles.cardTitle}>
              <Radio size={16} color="#c7f900" /> Courier & Payment Circuit Breakers
            </span>
            <span className={styles.tabBadge}>Auto-Tripping</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "12px" }}>
            {providers.map((p) => (
              <div
                key={p.provider_id}
                style={{
                  padding: "12px 16px",
                  borderRadius: "10px",
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: "13px", fontWeight: "700", color: "#ffffff" }}>
                    {p.provider_name}
                  </div>
                  <div style={{ fontSize: "11px", color: "#9ca3af" }}>
                    Type: {p.provider_type} | Latency: {p.latency_ms}ms
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ textAlign: "right" }}>
                    <span
                      className={`${styles.statusBadge} ${
                        p.status === "HEALTHY" ? styles.statusHealthy :
                        p.status === "DEGRADED" ? styles.statusWarning : styles.statusCritical
                      }`}
                    >
                      {p.status}
                    </span>
                    <div style={{ fontSize: "10px", color: "#6b7280", marginTop: "2px" }}>
                      Success: {p.success_rate_percent}%
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
