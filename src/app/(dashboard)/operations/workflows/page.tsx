"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Workflow,
  Play,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  FileCheck2,
  FileText,
  Boxes,
  Truck,
  DollarSign,
  TrendingDown,
  RefreshCw,
  Lock,
} from "lucide-react";
import styles from "../operations.module.css";
import { ActionReceipt } from "@/types/orchestration";

interface WorkflowDef {
  id: string;
  name: string;
  domain: string;
  description: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  leadAgent: string;
  governanceControls: string[];
}

const WORKFLOWS: WorkflowDef[] = [
  {
    id: "LOW_STOCK_REPLENISHMENT",
    name: "Low Stock Replenishment & Restock",
    domain: "Inventory & Procurement",
    description: "Detects forward stockout risks across warehouses and drafts purchase orders with MOQ validation.",
    riskLevel: "HIGH",
    leadAgent: "PROCUREMENT",
    governanceControls: ["Daily Spend Budget Check", "Supplier MOQ Verification", "Human Approval if > ৳50,000"],
  },
  {
    id: "STOCKOUT_PREVENTION",
    name: "Warehouse Inventory Balancing",
    domain: "Inventory Operations",
    description: "Evaluates multi-warehouse stock imbalances and issues transit transfer orders to prevent local stockouts.",
    riskLevel: "MEDIUM",
    leadAgent: "INVENTORY_OPERATIONS",
    governanceControls: ["Transit Hours Simulation", "Safety Stock Retention", "Action Budget Limit"],
  },
  {
    id: "DELAYED_SHIPMENT_FAILOVER",
    name: "Delayed Consignment Failover",
    domain: "Fulfillment & Courier",
    description: "Audits shipments in transit (>36h) and auto-fails over delayed parcels to healthy alternate couriers.",
    riskLevel: "LOW",
    leadAgent: "COURIER_OPERATIONS",
    governanceControls: ["Courier Circuit Breaker", "Consignment State Lock", "Audit Log Trail"],
  },
  {
    id: "PAYMENT_FAILURE_RECOVERY",
    name: "Payment Variance & MFS Recovery",
    domain: "Payment Operations",
    description: "Scans timed-out online payments and cross-checks pending bKash/Nagad TrxIDs against bank settlements.",
    riskLevel: "LOW",
    leadAgent: "PAYMENT_OPERATIONS",
    governanceControls: ["Zero-Hallucination Math", "Deterministic TrxID Match", "Duplicate Prevention"],
  },
  {
    id: "ORDER_EXCEPTION_RECOVERY",
    name: "Order Fulfillment Readiness Audit",
    domain: "Order Operations",
    description: "Validates customer delivery addresses and payment confirmation before releasing to warehouse pick & pack.",
    riskLevel: "LOW",
    leadAgent: "ORDER_OPERATIONS",
    governanceControls: ["Address Completeness Check", "Fraud Scoring Threshold", "Stock Reservation Lock"],
  },
  {
    id: "COURIER_FAILURE_RECOVERY",
    name: "Provider Incident Courier Failover",
    domain: "Courier Operations",
    description: "Responds to external provider API outages by dynamically tripping circuit breakers and routing to backup.",
    riskLevel: "MEDIUM",
    leadAgent: "COURIER_OPERATIONS",
    governanceControls: ["Circuit Breaker Trip", "Automated Courier Fallback", "Incident Logging"],
  },
  {
    id: "REFUND_EXCEPTION_RECOVERY",
    name: "High Return Rate Investigation",
    domain: "Returns & Quality",
    description: "Flags products with >15% return rate and recommends supplier reviews or sizing chart corrections.",
    riskLevel: "LOW",
    leadAgent: "RETURNS_OPERATIONS",
    governanceControls: ["Defect Reason Clustering", "Supplier Feedback Loop", "Catalog Quarantine"],
  },
  {
    id: "INVENTORY_RECONCILIATION",
    name: "Warehouse Physical Discrepancy Audit",
    domain: "Inventory Operations",
    description: "Reconciles counted inventory against system ledger; flags variances and updates safety stock.",
    riskLevel: "MEDIUM",
    leadAgent: "INVENTORY_OPERATIONS",
    governanceControls: ["Double-Entry Verification", "Shrinkage Threshold Alert", "Manager Confirmation"],
  },
  {
    id: "DAILY_OPERATIONAL_BRIEF",
    name: "Daily Executive Financial Brief",
    domain: "Finance & Accounting",
    description: "Computes daily revenue collected, COD reconciliation, gateway fee breakdown, and gross operational profit.",
    riskLevel: "LOW",
    leadAgent: "FINANCE_OPERATIONS",
    governanceControls: ["Deterministic Arithmetic", "Read-Only Twin Query", "Receipt Stamping"],
  },
];

const STEPS = [
  { step: 1, label: "OBSERVE", desc: "Telemetry scan across digital twin & core database" },
  { step: 2, label: "DETECT", desc: "Identify operational anomalies, stockouts, or variances" },
  { step: 3, label: "UNDERSTAND", desc: "Correlate context, customer history & provider health" },
  { step: 4, label: "DECIDE", desc: "Formulate candidate corrective operational actions" },
  { step: 5, label: "SIMULATE", desc: "Pre-execution test: verify margin & delivery impacts" },
  { step: 6, label: "POLICY CHECK", desc: "Verify RBAC, safety boundaries & daily spend limits" },
  { step: 7, label: "APPROVAL", desc: "Check human approval threshold if action risk is HIGH" },
  { step: 8, label: "PLAN", desc: "Generate sequential execution graph with rollback steps" },
  { step: 9, label: "EXECUTE", desc: "Commit mutation strictly via authorized domain service" },
  { step: 10, label: "VERIFY", desc: "Re-query state to confirm physical success in database" },
  { step: 11, label: "RECORD", desc: "Mint immutable, cryptographically verifiable ActionReceipt" },
];

export default function OperationsWorkflowsPage() {
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowDef>(WORKFLOWS[0]);
  const [activeStep, setActiveStep] = useState<number>(0);
  const [executing, setExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    try {
      setExecuting(true);
      setError(null);
      setExecutionResult(null);

      // Simulate visual stepping progression through the 11-step loop
      for (let s = 1; s <= 9; s++) {
        setActiveStep(s);
        await new Promise((r) => setTimeout(r, 120));
      }

      const res = await fetch("/api/v1/operations/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow_type: selectedWorkflow.id }),
      });

      if (res.status === 401) throw new Error("UNAUTHORIZED");
      if (res.status === 403) throw new Error("NO_PERMISSION");

      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Workflow execution failed");

      setActiveStep(10);
      await new Promise((r) => setTimeout(r, 150));
      setActiveStep(11);

      setExecutionResult(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Execution failed");
      setActiveStep(0);
    } finally {
      setExecuting(false);
    }
  };

  // Unauthorized State
  if (error === "UNAUTHORIZED") {
    return (
      <div className={styles.container}>
        <div className={styles.stateContainer}>
          <div className={styles.stateIcon}><Lock size={24} /></div>
          <h2 className={styles.stateTitle}>Authentication Required</h2>
          <p className={styles.stateDescription}>Please log in to operate autonomous workflows.</p>
        </div>
      </div>
    );
  }

  // No Permission State
  if (error === "NO_PERMISSION") {
    return (
      <div className={styles.container}>
        <div className={styles.stateContainer}>
          <div className={styles.stateIcon}><ShieldCheck size={24} /></div>
          <h2 className={styles.stateTitle}>Permission Denied</h2>
          <p className={styles.stateDescription}>You need `operations.execute` permission to dispatch workflows.</p>
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
            <Workflow size={28} color="#c7f900" />
            Autonomous Workflows Engine
          </h1>
          <p className={styles.headerSubtitle}>
            11-Step Policy-Governed Autonomous Execution Loop with Zero-Hallucination Verification
          </p>
        </div>
      </div>

      {/* Subnav */}
      <div className={styles.subnav}>
        <Link href="/operations" className={styles.tabLink}>
          Overview
        </Link>
        <Link href="/operations/workflows" className={`${styles.tabLink} ${styles.tabLinkActive}`}>
          Workflows
        </Link>
        <Link href="/operations/exceptions" className={styles.tabLink}>
          Exceptions
        </Link>
        <Link href="/operations/autonomy" className={styles.tabLink}>
          Autonomy & Safety
        </Link>
        <Link href="/operations/receipts" className={styles.tabLink}>
          Action Receipts
        </Link>
      </div>

      <div className={styles.bentoGrid}>
        {/* Left Column: Workflow Selector */}
        <div className={`${styles.card} ${styles.col4}`}>
          <div className={styles.cardHeader}>
            <span className={styles.cardTitle}>Available Operations Workflows</span>
            <span className={styles.tabBadge}>{WORKFLOWS.length} Built-in</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "600px", overflowY: "auto" }}>
            {WORKFLOWS.map((wf) => (
              <div
                key={wf.id}
                onClick={() => {
                  setSelectedWorkflow(wf);
                  setExecutionResult(null);
                  setActiveStep(0);
                }}
                style={{
                  padding: "12px 16px",
                  borderRadius: "10px",
                  cursor: "pointer",
                  background: selectedWorkflow.id === wf.id ? "rgba(199, 249, 0, 0.1)" : "rgba(255, 255, 255, 0.02)",
                  border: selectedWorkflow.id === wf.id ? "1px solid rgba(199, 249, 0, 0.3)" : "1px solid rgba(255, 255, 255, 0.05)",
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <span style={{ fontSize: "13px", fontWeight: "700", color: selectedWorkflow.id === wf.id ? "#c7f900" : "#ffffff" }}>
                    {wf.name}
                  </span>
                  <span
                    className={`${styles.statusBadge} ${
                      wf.riskLevel === "LOW" ? styles.statusHealthy :
                      wf.riskLevel === "MEDIUM" ? styles.statusWarning : styles.statusCritical
                    }`}
                    style={{ fontSize: "9px", padding: "2px 6px" }}
                  >
                    {wf.riskLevel}
                  </span>
                </div>
                <div style={{ fontSize: "11px", color: "#9ca3af" }}>{wf.domain}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Stepper & Execution Plane */}
        <div className={`${styles.card} ${styles.col8}`}>
          <div className={styles.cardHeader}>
            <div>
              <span className={styles.cardTitle}>{selectedWorkflow.name}</span>
              <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "4px" }}>
                Lead Agent: <strong>{selectedWorkflow.leadAgent}</strong> | Domain: <strong>{selectedWorkflow.domain}</strong>
              </div>
            </div>
            <button
              className={styles.btnPrimary}
              onClick={handleRun}
              disabled={executing}
            >
              {executing ? <RefreshCw size={14} className={styles.spinner} /> : <Play size={14} />}
              {executing ? "Running Stepper..." : "Dispatch Workflow"}
            </button>
          </div>

          <p style={{ fontSize: "13px", color: "#e5e7eb", margin: "0 0 16px 0" }}>
            {selectedWorkflow.description}
          </p>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "20px" }}>
            {selectedWorkflow.governanceControls.map((ctrl, idx) => (
              <span key={idx} className={styles.statusHealthy} style={{ fontSize: "11px", padding: "4px 10px", borderRadius: "9999px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                <ShieldCheck size={12} /> {ctrl}
              </span>
            ))}
          </div>

          {/* Stepper Timeline */}
          <div className={styles.stepperContainer}>
            <div style={{ fontSize: "12px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.06em", color: "#9ca3af", marginBottom: "8px" }}>
              11-Stage Governed Execution Progression
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "8px" }}>
              {STEPS.map((s) => {
                const isPassed = activeStep >= s.step;
                const isCurrent = activeStep === s.step && executing;

                return (
                  <div
                    key={s.step}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "8px",
                      background: isCurrent ? "rgba(199, 249, 0, 0.15)" : isPassed ? "rgba(16, 185, 129, 0.08)" : "rgba(255, 255, 255, 0.02)",
                      border: isCurrent ? "1px solid #c7f900" : isPassed ? "1px solid rgba(16, 185, 129, 0.3)" : "1px solid rgba(255, 255, 255, 0.05)",
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      transition: "all 0.2s ease",
                    }}
                  >
                    <div
                      style={{
                        width: "22px",
                        height: "22px",
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "11px",
                        fontWeight: "800",
                        background: isPassed ? "#10b981" : "rgba(255, 255, 255, 0.1)",
                        color: isPassed ? "#ffffff" : "#9ca3af",
                      }}
                    >
                      {isPassed ? <CheckCircle2 size={13} /> : s.step}
                    </div>
                    <div>
                      <div style={{ fontSize: "11px", fontWeight: "700", color: isCurrent ? "#c7f900" : isPassed ? "#ffffff" : "#9ca3af" }}>
                        {s.label}
                      </div>
                      <div style={{ fontSize: "10px", color: "#6b7280" }}>{s.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Execution Result & Verified Receipts Preview */}
          {executionResult && (
            <div style={{ marginTop: "24px", borderTop: "1px solid rgba(255, 255, 255, 0.08)", paddingTop: "16px" }}>
              <div className={styles.cardHeader}>
                <span className={styles.cardTitle} style={{ color: "#34d399" }}>
                  <FileCheck2 size={16} /> Workflow Execution Succeeded
                </span>
                <span className={styles.statusHealthy}>Status: {executionResult.status}</span>
              </div>

              <div style={{ fontSize: "13px", color: "#e5e7eb", marginBottom: "12px" }}>
                <strong>Summary:</strong> {executionResult.summary}
              </div>

              {executionResult.receipts && executionResult.receipts.length > 0 && (
                <div>
                  <div style={{ fontSize: "12px", fontWeight: "700", color: "#9ca3af", marginBottom: "6px" }}>
                    Verified ActionReceipts Generated ({executionResult.receipts.length}):
                  </div>
                  <pre className={styles.receiptSnippet}>
                    {JSON.stringify(executionResult.receipts, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {error && (
            <div style={{ marginTop: "16px", padding: "12px 16px", background: "rgba(239, 68, 68, 0.15)", border: "1px solid #ef4444", borderRadius: "8px", color: "#fca5a5", fontSize: "13px" }}>
              <strong>Execution Error:</strong> {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
