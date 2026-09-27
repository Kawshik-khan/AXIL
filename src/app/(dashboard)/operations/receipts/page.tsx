"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  FileCheck2,
  ShieldCheck,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  Lock,
  AlertTriangle,
  Code2,
} from "lucide-react";
import styles from "../operations.module.css";
import { ActionReceipt } from "@/types/orchestration";

export default function OperationsReceiptsPage() {
  const [receipts, setReceipts] = useState<ActionReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterAgent, setFilterAgent] = useState<string>("ALL");
  const [selectedReceipt, setSelectedReceipt] = useState<ActionReceipt | null>(null);

  const fetchReceipts = async () => {
    try {
      setLoading(true);
      setError(null);

      let url = "/api/v1/operations/receipts";
      if (filterAgent !== "ALL") {
        url += `?actor_agent=${filterAgent}`;
      }

      const res = await fetch(url);
      if (res.status === 401) throw new Error("UNAUTHORIZED");
      if (res.status === 403) throw new Error("NO_PERMISSION");

      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to load receipts");

      setReceipts(json.data.receipts || []);
      if (json.data.receipts?.length > 0 && !selectedReceipt) {
        setSelectedReceipt(json.data.receipts[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error fetching receipts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReceipts();
  }, [filterAgent]);

  // 1. Loading State
  if (loading && receipts.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.stateContainer}>
          <div className={styles.spinner} />
          <h2 className={styles.stateTitle}>Loading Action Receipts...</h2>
          <p className={styles.stateDescription}>Retrieving cryptographically verifiable operation receipts from immutable ledger.</p>
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
          <p className={styles.stateDescription}>Please sign in to view operational action receipts.</p>
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
          <p className={styles.stateDescription}>You need `operations.read` permission to audit action receipts.</p>
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
          <h2 className={styles.stateTitle}>Failed to Load Receipts</h2>
          <p className={styles.stateDescription}>{error}</p>
          <button className={styles.btnPrimary} onClick={fetchReceipts}>Retry</button>
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
            <FileCheck2 size={28} color="#c7f900" />
            Action Receipts & Audit Trail
          </h1>
          <p className={styles.headerSubtitle}>
            Physical, Zero-Hallucination Verified Execution Receipts with Idempotency Keys
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={fetchReceipts}>
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
        <Link href="/operations/exceptions" className={styles.tabLink}>
          Exceptions
        </Link>
        <Link href="/operations/autonomy" className={styles.tabLink}>
          Autonomy & Safety
        </Link>
        <Link href="/operations/receipts" className={`${styles.tabLink} ${styles.tabLinkActive}`}>
          Action Receipts ({receipts.length})
        </Link>
      </div>

      {/* Filter Bar */}
      <div className={styles.card} style={{ marginBottom: "20px", padding: "12px 20px" }}>
        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: "12px", fontWeight: "700", color: "#9ca3af", textTransform: "uppercase" }}>
            Filter by Agent:
          </span>
          {[
            "ALL",
            "OPERATIONS_SUPERVISOR",
            "INVENTORY_OPERATIONS",
            "PROCUREMENT",
            "PRICING",
            "ORDER_OPERATIONS",
            "COURIER_OPERATIONS",
            "PAYMENT_OPERATIONS",
            "FINANCE_OPERATIONS",
            "RETURNS_OPERATIONS",
          ].map((agent) => (
            <button
              key={agent}
              onClick={() => setFilterAgent(agent)}
              style={{
                padding: "4px 10px",
                borderRadius: "6px",
                fontSize: "11px",
                fontWeight: "600",
                border: "none",
                cursor: "pointer",
                background: filterAgent === agent ? "#c7f900" : "rgba(255, 255, 255, 0.05)",
                color: filterAgent === agent ? "#121316" : "#9ca3af",
              }}
            >
              {agent.replace("_OPERATIONS", "").replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      {/* 5. Empty State */}
      {receipts.length === 0 ? (
        <div className={styles.card}>
          <div className={styles.stateContainer}>
            <div className={styles.stateIcon}><FileCheck2 size={32} /></div>
            <h2 className={styles.stateTitle}>No Action Receipts Found</h2>
            <p className={styles.stateDescription}>
              Run an autonomous workflow from the Workflows tab to mint verified action receipts.
            </p>
            <Link href="/operations/workflows" className={styles.btnPrimary}>
              Go to Workflows
            </Link>
          </div>
        </div>
      ) : (
        /* 6. Success State: Two Column Ledger View */
        <div className={styles.bentoGrid}>
          {/* Receipts Table */}
          <div className={`${styles.card} ${styles.col7}`}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>Verified Receipt Stream</span>
              <span className={styles.tabBadge}>{receipts.length} Stamped</span>
            </div>

            <div className={styles.tableContainer}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Agent</th>
                    <th>Target</th>
                    <th>Status</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedReceipt(r)}
                      style={{
                        cursor: "pointer",
                        background: selectedReceipt?.id === r.id ? "rgba(199, 249, 0, 0.08)" : undefined,
                      }}
                    >
                      <td style={{ fontWeight: "700", color: "#ffffff" }}>
                        {r.action}
                      </td>
                      <td style={{ fontSize: "11px", color: "#c7f900" }}>
                        {r.actor_agent}
                      </td>
                      <td style={{ fontSize: "11px", color: "#9ca3af" }}>
                        {r.target_entity}:{r.target_id.substring(0, 8)}...
                      </td>
                      <td>
                        <span
                          className={`${styles.statusBadge} ${
                            r.status === "SUCCESS" ? styles.statusHealthy : styles.statusCritical
                          }`}
                          style={{ fontSize: "10px", padding: "2px 6px" }}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td style={{ fontSize: "11px", color: "#6b7280" }}>
                        {new Date(r.created_at).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Receipt Inspector */}
          <div className={`${styles.card} ${styles.col5}`}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>
                <Code2 size={16} color="#c7f900" /> Receipt Audit Inspector
              </span>
              {selectedReceipt && (
                <span className={styles.statusHealthy}>
                  <CheckCircle2 size={12} /> Verified
                </span>
              )}
            </div>

            {selectedReceipt ? (
              <div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px", fontSize: "12px" }}>
                  <div>
                    <span style={{ color: "#9ca3af" }}>Receipt ID: </span>
                    <strong style={{ color: "#ffffff" }}>{selectedReceipt.id}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#9ca3af" }}>Idempotency Key: </span>
                    <code style={{ color: "#c7f900", background: "rgba(0,0,0,0.3)", padding: "2px 6px", borderRadius: "4px" }}>
                      {selectedReceipt.idempotency_key}
                    </code>
                  </div>
                  <div>
                    <span style={{ color: "#9ca3af" }}>Acting Agent: </span>
                    <strong style={{ color: "#ffffff" }}>{selectedReceipt.actor_agent}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#9ca3af" }}>Workflow ID: </span>
                    <strong style={{ color: "#ffffff" }}>{selectedReceipt.workflow_id}</strong>
                  </div>
                </div>

                <div style={{ fontSize: "12px", fontWeight: "700", color: "#9ca3af", marginBottom: "6px" }}>
                  Physical Execution Result Payload:
                </div>
                <pre className={styles.receiptSnippet} style={{ maxHeight: "350px", overflowY: "auto" }}>
                  {JSON.stringify(selectedReceipt.result, null, 2)}
                </pre>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af" }}>
                Select a receipt on the left to inspect its cryptographic payload.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
