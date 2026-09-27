"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Filter,
  RefreshCw,
  ShieldCheck,
  Search,
  ExternalLink,
  Lock,
} from "lucide-react";
import styles from "../operations.module.css";
import { OperationalException, ExceptionDomain, ExceptionSeverity } from "@/types/operations";

const DOMAINS: Array<ExceptionDomain | "ALL"> = [
  "ALL",
  "INVENTORY",
  "PROCUREMENT",
  "PRICING",
  "ORDERS",
  "FULFILLMENT",
  "SHIPPING",
  "PAYMENTS",
  "FINANCE",
  "SUPPORT",
  "RETURNS",
  "PROVIDER",
];

export default function OperationsExceptionsPage() {
  const [exceptions, setExceptions] = useState<OperationalException[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<string>("ALL");
  const [selectedSeverity, setSelectedSeverity] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState<string>("");

  const fetchExceptions = async () => {
    try {
      setLoading(true);
      setError(null);

      let url = "/api/v1/operations/exceptions";
      const params = new URLSearchParams();
      if (selectedDomain !== "ALL") params.append("domain", selectedDomain);
      if (selectedSeverity !== "ALL") params.append("severity", selectedSeverity);
      if (params.toString()) url += `?${params.toString()}`;

      const res = await fetch(url);
      if (res.status === 401) throw new Error("UNAUTHORIZED");
      if (res.status === 403) throw new Error("NO_PERMISSION");

      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to load exceptions");

      setExceptions(json.data.exceptions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error fetching exceptions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExceptions();
  }, [selectedDomain, selectedSeverity]);

  const handleResolve = async (id: string) => {
    try {
      setResolvingId(id);
      const res = await fetch(`/api/v1/operations/exceptions/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resolution_notes: resolutionNotes || "Resolved manually by operator via Operations Command Center.",
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to resolve exception");

      setResolutionNotes("");
      await fetchExceptions();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to resolve exception");
    } finally {
      setResolvingId(null);
    }
  };

  // 1. Loading State
  if (loading && exceptions.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.stateContainer}>
          <div className={styles.spinner} />
          <h2 className={styles.stateTitle}>Loading Operational Exceptions...</h2>
          <p className={styles.stateDescription}>Scanning cross-domain anomaly telemetry and audit logs.</p>
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
          <p className={styles.stateDescription}>Please log in to manage operational exceptions.</p>
        </div>
      </div>
    );
  }

  // 3. No Permission State
  if (error === "NO_PERMISSION") {
    return (
      <div className={styles.container}>
        <div className={styles.stateContainer}>
          <div className={styles.stateIcon}><ShieldCheck size={24} /></div>
          <h2 className={styles.stateTitle}>Access Denied</h2>
          <p className={styles.stateDescription}>You need `exceptions.read` permission to view operational exceptions.</p>
        </div>
      </div>
    );
  }

  // 4. Error State
  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.stateContainer}>
          <div className={styles.stateIcon}><AlertTriangle size={24} color="#ef4444" /></div>
          <h2 className={styles.stateTitle}>Failed to Load Exceptions</h2>
          <p className={styles.stateDescription}>{error}</p>
          <button className={styles.btnPrimary} onClick={fetchExceptions}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h1>
            <AlertTriangle size={28} color="#fbbf24" />
            Operational Exception Center
          </h1>
          <p className={styles.headerSubtitle}>
            Active Operational Anomalies, Root Cause Hypotheses, and Governed Resolutions
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={fetchExceptions}>
            <RefreshCw size={14} className={loading ? styles.spinner : ""} /> Refresh
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
        <Link href="/operations/exceptions" className={`${styles.tabLink} ${styles.tabLinkActive}`}>
          Exceptions ({exceptions.length})
        </Link>
        <Link href="/operations/autonomy" className={styles.tabLink}>
          Autonomy & Safety
        </Link>
        <Link href="/operations/receipts" className={styles.tabLink}>
          Action Receipts
        </Link>
      </div>

      {/* Filter Bar */}
      <div className={styles.card} style={{ marginBottom: "20px", padding: "14px 20px" }}>
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: "12px", fontWeight: "700", color: "#9ca3af", textTransform: "uppercase" }}>
              Domain:
            </span>
            <div style={{ display: "flex", gap: "6px", overflowX: "auto" }}>
              {DOMAINS.map((d) => (
                <button
                  key={d}
                  onClick={() => setSelectedDomain(d)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: "6px",
                    fontSize: "11px",
                    fontWeight: "600",
                    border: "none",
                    cursor: "pointer",
                    background: selectedDomain === d ? "#c7f900" : "rgba(255, 255, 255, 0.05)",
                    color: selectedDomain === d ? "#121316" : "#9ca3af",
                  }}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <span style={{ fontSize: "12px", fontWeight: "700", color: "#9ca3af", textTransform: "uppercase" }}>
              Severity:
            </span>
            {["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"].map((sev) => (
              <button
                key={sev}
                onClick={() => setSelectedSeverity(sev)}
                style={{
                  padding: "4px 10px",
                  borderRadius: "6px",
                  fontSize: "11px",
                  fontWeight: "600",
                  border: "none",
                  cursor: "pointer",
                  background: selectedSeverity === sev ? "#c7f900" : "rgba(255, 255, 255, 0.05)",
                  color: selectedSeverity === sev ? "#121316" : "#9ca3af",
                }}
              >
                {sev}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 5. Empty State */}
      {exceptions.length === 0 ? (
        <div className={styles.card}>
          <div className={styles.stateContainer}>
            <div className={styles.stateIcon} style={{ background: "rgba(16, 185, 129, 0.1)", color: "#34d399" }}>
              <CheckCircle2 size={32} />
            </div>
            <h2 className={styles.stateTitle}>Zero Operational Exceptions Detected</h2>
            <p className={styles.stateDescription}>
              All operational indicators across Inventory, Couriers, and Payments are functioning within healthy bounds.
            </p>
          </div>
        </div>
      ) : (
        /* 6. Success State: Exceptions List */
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {exceptions.map((exc) => (
            <div key={exc.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span
                    className={`${styles.statusBadge} ${
                      exc.severity === "CRITICAL" ? styles.statusCritical :
                      exc.severity === "HIGH" ? styles.statusCritical :
                      exc.severity === "MEDIUM" ? styles.statusWarning : styles.statusHealthy
                    }`}
                  >
                    {exc.severity}
                  </span>
                  <span style={{ fontSize: "14px", fontWeight: "700", color: "#ffffff" }}>
                    {exc.title}
                  </span>
                  <span className={styles.tabBadge}>{exc.domain}</span>
                </div>
                <span style={{ fontSize: "12px", color: "#9ca3af" }}>
                  {new Date(exc.created_at).toLocaleString()}
                </span>
              </div>

              <p style={{ fontSize: "13px", color: "#e5e7eb", margin: "0 0 12px 0" }}>
                {exc.description}
              </p>

              {exc.root_cause_hypothesis && (
                <div style={{ padding: "10px 14px", background: "rgba(255, 255, 255, 0.03)", borderRadius: "8px", fontSize: "12px", marginBottom: "12px", borderLeft: "3px solid #c7f900" }}>
                  <strong style={{ color: "#c7f900" }}>Root Cause Hypothesis: </strong>
                  <span style={{ color: "#d1d5db" }}>{exc.root_cause_hypothesis}</span>
                </div>
              )}

              {exc.proposed_action && (
                <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "16px" }}>
                  <strong>Proposed Remedy: </strong>
                  <span>{exc.proposed_action.description}</span>
                  <span style={{ marginLeft: "8px", color: "#fbbf24" }}>
                    (Risk: {exc.proposed_action.risk_level})
                  </span>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid rgba(255, 255, 255, 0.06)", paddingTop: "12px" }}>
                <span style={{ fontSize: "11px", color: "#6b7280" }}>
                  Assigned Agent: <strong>{exc.assigned_agent || "OPERATIONS_SUPERVISOR"}</strong> | Entity: {exc.entity_type} ({exc.entity_id})
                </span>

                {exc.status === "RESOLVED" ? (
                  <span className={styles.statusHealthy}>
                    <CheckCircle2 size={12} /> Resolved
                  </span>
                ) : (
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      className={styles.btnPrimary}
                      onClick={() => handleResolve(exc.id)}
                      disabled={resolvingId === exc.id}
                    >
                      {resolvingId === exc.id ? "Resolving..." : "Mark Resolved"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
