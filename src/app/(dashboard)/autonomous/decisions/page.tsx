"use client";

import React, { useEffect, useState } from "react";
import {
  Scale,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowUpRight,
  ShieldAlert,
  Clock,
  Sparkles,
} from "lucide-react";
import styles from "../autonomous.module.css";
import { AutonomousNav } from "../components/AutonomousNav";
import { GlobalDecision } from "@/types/autonomous";

export default function AutonomousDecisionsPage() {
  const [decisions, setDecisions] = useState<GlobalDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const fetchDecisions = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/v1/autonomous/decisions");
      if (res.status === 401) { setError("UNAUTHORIZED"); return; }
      if (res.status === 403) { setError("NO_PERMISSION"); return; }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to load decisions");
      setDecisions(json.data.decisions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error fetching decisions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDecisions();
  }, []);

  const handleApprove = async (decisionId: string) => {
    try {
      setActionInProgress(decisionId);
      const res = await fetch(`/api/v1/autonomous/decisions/${decisionId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved_by: "administrator" }),
      });
      if (!res.ok) {
        const json = await res.json();
        alert("Failed to approve: " + (json.error?.message || "Unknown error"));
      } else {
        await fetchDecisions();
      }
    } catch (err) {
      alert("Approval request failed");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleReject = async (decisionId: string) => {
    const reason = prompt("Enter reason for rejection:", "Risk threshold exceeded");
    if (!reason) return;
    try {
      setActionInProgress(decisionId);
      const res = await fetch(`/api/v1/autonomous/decisions/${decisionId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const json = await res.json();
        alert("Failed to reject: " + (json.error?.message || "Unknown error"));
      } else {
        await fetchDecisions();
      }
    } catch (err) {
      alert("Rejection request failed");
    } finally {
      setActionInProgress(null);
    }
  };

  const filtered = statusFilter === "ALL"
    ? decisions
    : decisions.filter((d) => d.status === statusFilter);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h1>
            <Scale size={28} color="#c7f900" />
            Autonomous Decision Center
          </h1>
          <p className={styles.headerSubtitle}>
            Full inspectability of multi-objective decisions, simulation tradeoffs, policy assertions, and human approval gates.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={fetchDecisions}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <AutonomousNav />

      {/* Filter Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {["ALL", "AWAITING_APPROVAL", "APPROVED", "EXECUTING", "VERIFIED", "REJECTED"].map((st) => (
          <button
            key={st}
            onClick={() => setStatusFilter(st)}
            className={`${styles.btn} ${statusFilter === st ? styles.btnPrimary : styles.btnSecondary}`}
            style={{ padding: "6px 14px", fontSize: 12 }}
          >
            {st}
          </button>
        ))}
      </div>

      {loading ? (
        <div className={styles.emptyState}>
          <RefreshCw className="animate-spin" size={32} color="#c7f900" />
          <p className={styles.emptyStateTitle} style={{ marginTop: 16 }}>Loading autonomous decisions...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <Scale size={48} color="#9ca3af" />
          <h2 className={styles.emptyStateTitle}>No Decisions Found</h2>
          <p className={styles.emptyStateSubtitle}>There are currently no decisions matching status "{statusFilter}".</p>
        </div>
      ) : (
        <div className={styles.bentoGrid}>
          {filtered.map((dec) => (
            <div key={dec.id} className={`${styles.card} ${styles.col12}`}>
              <div className={styles.cardHeader}>
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className={`${styles.originBadge} ${styles.originAutonomous}`}>{dec.category}</span>
                    <span className={`${styles.statusPill} ${dec.risk_level === "HIGH" ? styles.statusCritical : styles.statusHealthy}`}>
                      {dec.risk_level} RISK
                    </span>
                  </div>
                  <h3 className={styles.cardTitle} style={{ marginTop: 8 }}>{dec.title}</h3>
                </div>
                <span className={`${styles.statusPill} ${dec.status === "AWAITING_APPROVAL" ? styles.statusPending : dec.status === "APPROVED" || dec.status === "VERIFIED" ? styles.statusHealthy : styles.statusCritical}`}>
                  {dec.status}
                </span>
              </div>

              <p style={{ fontSize: 13, color: "#9ca3af", marginBottom: 14 }}>{dec.description}</p>

              {/* Options Breakdown */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#d1d5db", marginBottom: 8 }}>EVALUATED OPTIONS:</div>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(3, dec.options.length)}, 1fr)`, gap: 12 }}>
                  {dec.options.map((opt) => (
                    <div key={opt.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, color: "#fff" }}>
                        <span>{opt.name}</span>
                        <span style={{ color: "#c7f900" }}>Score: {opt.risk_score}</span>
                      </div>
                      <p style={{ fontSize: 12, color: "#9ca3af", margin: "6px 0" }}>{opt.description}</p>
                      <div style={{ fontSize: 11, color: "#60a5fa" }}>
                        Est. Cost: ৳{opt.estimated_cost_bdt?.toLocaleString() || 0}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action buttons if awaiting approval */}
              {dec.status === "AWAITING_APPROVAL" && (
                <div style={{ display: "flex", gap: 12, marginTop: "auto", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 14 }}>
                  <button
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    onClick={() => handleApprove(dec.id)}
                    disabled={actionInProgress === dec.id}
                  >
                    <CheckCircle2 size={14} /> Approve Decision
                  </button>
                  <button
                    className={`${styles.btn} ${styles.btnDanger}`}
                    onClick={() => handleReject(dec.id)}
                    disabled={actionInProgress === dec.id}
                  >
                    <XCircle size={14} /> Reject Decision
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
