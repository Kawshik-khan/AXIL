"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Workflow,
  Play,
  Pause,
  RotateCcw,
  XCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Zap,
  Layers,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Search,
  RefreshCw,
} from "lucide-react";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { Badge } from "@/components/ui/Badge/Badge";
import { Button } from "@/components/ui/Button/Button";
import { LoadingState, EmptyState, ErrorState } from "@/components/ui/States/States";
import { AgentWorkflow, WorkflowStatus } from "@/types/orchestration";

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<AgentWorkflow[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New Workflow Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [objectiveInput, setObjectiveInput] = useState("");
  const [workflowNameInput, setWorkflowNameInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [simulationResult, setSimulationResult] = useState<any>(null);

  const fetchWorkflows = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const url =
        statusFilter === "ALL"
          ? "/api/v1/ai/workflows"
          : `/api/v1/ai/workflows?status=${statusFilter}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to load workflows");
      setWorkflows(data.data || []);

      const metricsRes = await fetch("/api/v1/ai/workflows/metrics");
      const metricsData = await metricsRes.json();
      if (metricsRes.ok) {
        setMetrics(metricsData.data);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load orchestration workflows");
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  const handleAction = async (workflowId: string, action: string) => {
    try {
      const res = await fetch(`/api/v1/ai/workflows/${workflowId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error?.message || `Failed to perform action: ${action}`);
      }
      fetchWorkflows();
    } catch (err: any) {
      alert(err.message || "Error performing action");
    }
  };

  const handleSimulate = async () => {
    if (!objectiveInput.trim()) return;
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/v1/ai/workflows/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective: objectiveInput }),
      });
      const data = await res.json();
      if (res.ok) {
        setSimulationResult(data.data);
      } else {
        alert(data.error?.message || "Simulation failed");
      }
    } catch (err: any) {
      alert(err.message || "Failed to run simulation");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreate = async () => {
    if (!objectiveInput.trim()) return;
    setIsSubmitting(true);
    try {
      const name = workflowNameInput.trim() || `Workflow: ${objectiveInput.slice(0, 30)}...`;
      const res = await fetch("/api/v1/ai/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          objective: objectiveInput,
          auto_start: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to create workflow");
      setShowCreateModal(false);
      setObjectiveInput("");
      setWorkflowNameInput("");
      setSimulationResult(null);
      fetchWorkflows();
    } catch (err: any) {
      alert(err.message || "Failed to create workflow");
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return "success";
      case "RUNNING":
        return "active";
      case "WAITING":
        return "pending";
      case "FAILED":
        return "suspended";
      default:
        return "default";
    }
  };

  return (
    <div style={{ width: "100%", paddingBottom: "80px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "2rem",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#fff", margin: 0 }}>
              Autonomous Multi-Agent Orchestration
            </h1>
            <Badge variant="active">Phase 5</Badge>
          </div>
          <p style={{ color: "#9ca3af", margin: "0.25rem 0 0 0", fontSize: "0.95rem" }}>
            Supervisor Task Planner, Deterministic DAG Verification, and Human-in-the-Loop Control
          </p>
        </div>

        <div style={{ display: "flex", gap: "0.75rem" }}>
          <Button variant="outline" onClick={fetchWorkflows}>
            <RefreshCw size={16} style={{ marginRight: "0.5rem" }} /> Refresh
          </Button>
          <Button variant="primary" onClick={() => setShowCreateModal(true)}>
            <Sparkles size={16} style={{ marginRight: "0.5rem" }} /> New Autonomous Workflow
          </Button>
        </div>
      </div>

      {/* Top Bento Metrics */}
      <div style={{ marginBottom: "2rem" }}>
        <BentoGrid>
          <BentoCard span={3}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "#9ca3af", fontSize: "0.85rem", fontWeight: 500 }}>
                TOTAL WORKFLOWS
              </span>
              <Workflow size={18} color="#C7F900" />
            </div>
            <div style={{ fontSize: "2rem", fontWeight: 700, color: "#fff", marginTop: "0.5rem" }}>
              {metrics?.total_workflows ?? 0}
            </div>
            <div style={{ color: "#10b981", fontSize: "0.8rem", marginTop: "0.25rem" }}>
              Success rate: {typeof metrics?.success_rate === "number" ? `${metrics.success_rate}%` : "—"}
            </div>
          </BentoCard>

          <BentoCard span={3}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "#9ca3af", fontSize: "0.85rem", fontWeight: 500 }}>ACTIVE RUNS</span>
              <Zap size={18} color="#38bdf8" />
            </div>
            <div style={{ fontSize: "2rem", fontWeight: 700, color: "#38bdf8", marginTop: "0.5rem" }}>
              {metrics?.active_workflows ?? 0}
            </div>
            <div style={{ color: "#9ca3af", fontSize: "0.8rem", marginTop: "0.25rem" }}>
              Executing DAG steps
            </div>
          </BentoCard>

          <BentoCard span={3}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "#9ca3af", fontSize: "0.85rem", fontWeight: 500 }}>
                WAITING APPROVAL
              </span>
              <AlertTriangle size={18} color="#f59e0b" />
            </div>
            <div style={{ fontSize: "2rem", fontWeight: 700, color: "#f59e0b", marginTop: "0.5rem" }}>
              {metrics?.waiting_approval_workflows ?? 0}
            </div>
            <div style={{ color: "#9ca3af", fontSize: "0.8rem", marginTop: "0.25rem" }}>
              <Link href="/ai/approvals" style={{ color: "#f59e0b", textDecoration: "underline" }}>
                Review pending approvals &rarr;
              </Link>
            </div>
          </BentoCard>

          <BentoCard span={3}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "#9ca3af", fontSize: "0.85rem", fontWeight: 500 }}>
                VERIFIED RECEIPTS
              </span>
              <ShieldCheck size={18} color="#C7F900" />
            </div>
            <div style={{ fontSize: "2rem", fontWeight: 700, color: "#C7F900", marginTop: "0.5rem" }}>
              {metrics?.total_action_receipts ?? 0}
            </div>
            <div style={{ color: "#9ca3af", fontSize: "0.8rem", marginTop: "0.25rem" }}>
              {metrics?.verifier_rejection_count ?? 0} claims rejected by Verifier
            </div>
          </BentoCard>
        </BentoGrid>
      </div>

      {/* Filter Tabs */}
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          borderBottom: "1px solid #2d2f36",
          paddingBottom: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        {["ALL", "RUNNING", "WAITING", "COMPLETED", "FAILED"].map((tab) => (
          <button
            key={tab}
            onClick={() => setStatusFilter(tab)}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "8px",
              background: statusFilter === tab ? "#C7F900" : "transparent",
              color: statusFilter === tab ? "#18191c" : "#9ca3af",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "0.85rem",
              transition: "all 0.2s ease",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Main List Table */}
      {isLoading ? (
        <LoadingState message="Loading autonomous workflows..." />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchWorkflows} />
      ) : workflows.length === 0 ? (
        <EmptyState
          title="No Workflows Found"
          description={
            statusFilter === "ALL"
              ? "You have not started any autonomous multi-agent workflows yet."
              : `No workflows currently match status: ${statusFilter}`
          }
          actionText="+ Create Autonomous Workflow"
          onAction={() => setShowCreateModal(true)}
        />
      ) : (
        <div
          style={{
            background: "#18191c",
            border: "1px solid #2d2f36",
            borderRadius: "12px",
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #2d2f36", background: "#1c1d22" }}>
                <th style={{ padding: "1rem", color: "#9ca3af", fontSize: "0.8rem", fontWeight: 600 }}>
                  WORKFLOW
                </th>
                <th style={{ padding: "1rem", color: "#9ca3af", fontSize: "0.8rem", fontWeight: 600 }}>
                  STATUS
                </th>
                <th style={{ padding: "1rem", color: "#9ca3af", fontSize: "0.8rem", fontWeight: 600 }}>
                  PROGRESS
                </th>
                <th style={{ padding: "1rem", color: "#9ca3af", fontSize: "0.8rem", fontWeight: 600 }}>
                  TRIGGER
                </th>
                <th style={{ padding: "1rem", color: "#9ca3af", fontSize: "0.8rem", fontWeight: 600 }}>
                  CREATED
                </th>
                <th
                  style={{
                    padding: "1rem",
                    color: "#9ca3af",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    textAlign: "right",
                  }}
                >
                  ACTIONS
                </th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((wf) => {
                const percent =
                  wf.total_steps > 0 ? Math.round((wf.current_step / wf.total_steps) * 100) : 0;
                return (
                  <tr
                    key={wf.id}
                    style={{
                      borderBottom: "1px solid #22242a",
                      transition: "background 0.15s ease",
                    }}
                  >
                    <td style={{ padding: "1rem" }}>
                      <Link
                        href={`/ai/workflows/${wf.id}`}
                        style={{
                          color: "#fff",
                          fontWeight: 600,
                          fontSize: "0.95rem",
                          textDecoration: "none",
                        }}
                      >
                        {wf.name}
                      </Link>
                      <div
                        style={{
                          color: "#6b7280",
                          fontSize: "0.8rem",
                          marginTop: "0.25rem",
                          maxWidth: "400px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {wf.objective}
                      </div>
                    </td>

                    <td style={{ padding: "1rem" }}>
                      <Badge variant={getStatusBadgeVariant(wf.status)}>
                        {wf.status}
                      </Badge>
                    </td>

                    <td style={{ padding: "1rem", minWidth: "160px" }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: "0.75rem",
                          color: "#9ca3af",
                          marginBottom: "0.25rem",
                        }}
                      >
                        <span>
                          Step {wf.current_step} of {wf.total_steps}
                        </span>
                        <span>{percent}%</span>
                      </div>
                      <div
                        style={{
                          height: "6px",
                          width: "100%",
                          background: "#2a2c34",
                          borderRadius: "4px",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${percent}%`,
                            background: wf.status === "FAILED" ? "#ef4444" : "#C7F900",
                            transition: "width 0.3s ease",
                          }}
                        />
                      </div>
                    </td>

                    <td style={{ padding: "1rem", color: "#9ca3af", fontSize: "0.85rem" }}>
                      {wf.trigger_type}
                    </td>

                    <td style={{ padding: "1rem", color: "#6b7280", fontSize: "0.8rem" }}>
                      {new Date(wf.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>

                    <td style={{ padding: "1rem", textAlign: "right" }}>
                      <div
                        style={{
                          display: "flex",
                          gap: "0.5rem",
                          justifyContent: "flex-end",
                          alignItems: "center",
                        }}
                      >
                        {wf.status === "RUNNING" && (
                          <button
                            onClick={() => handleAction(wf.id, "PAUSE")}
                            style={{
                              background: "#2a2c34",
                              border: "none",
                              color: "#fff",
                              borderRadius: "6px",
                              padding: "0.4rem 0.6rem",
                              cursor: "pointer",
                            }}
                            title="Pause Workflow"
                          >
                            <Pause size={14} />
                          </button>
                        )}
                        {(wf.status === "PAUSED" || wf.status === "WAITING") && (
                          <button
                            onClick={() => handleAction(wf.id, "RESUME")}
                            style={{
                              background: "#C7F900",
                              border: "none",
                              color: "#18191c",
                              borderRadius: "6px",
                              padding: "0.4rem 0.6rem",
                              cursor: "pointer",
                            }}
                            title="Resume Workflow"
                          >
                            <Play size={14} />
                          </button>
                        )}
                        {wf.status === "FAILED" && (
                          <button
                            onClick={() => handleAction(wf.id, "RETRY")}
                            style={{
                              background: "#38bdf8",
                              border: "none",
                              color: "#18191c",
                              borderRadius: "6px",
                              padding: "0.4rem 0.6rem",
                              cursor: "pointer",
                            }}
                            title="Retry Workflow"
                          >
                            <RotateCcw size={14} />
                          </button>
                        )}
                        <Link
                          href={`/ai/workflows/${wf.id}`}
                          style={{
                            color: "#C7F900",
                            fontSize: "0.85rem",
                            textDecoration: "none",
                            fontWeight: 600,
                            padding: "0.4rem 0.6rem",
                          }}
                        >
                          View DAG &rarr;
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: New Autonomous Workflow */}
      {showCreateModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            backdropFilter: "blur(6px)",
          }}
        >
          <div
            style={{
              background: "#18191c",
              border: "1px solid #2d2f36",
              borderRadius: "16px",
              padding: "2rem",
              width: "100%",
              maxWidth: "680px",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
          >
            <h2 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#fff", margin: 0 }}>
              Launch Autonomous Workflow
            </h2>
            <p style={{ color: "#9ca3af", fontSize: "0.85rem", marginTop: "0.25rem" }}>
              Supervisor decomposes this objective into a validated Directed Acyclic Graph (DAG).
            </p>

            <div style={{ marginTop: "1.5rem" }}>
              <label
                style={{
                  display: "block",
                  color: "#e5e7eb",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  marginBottom: "0.5rem",
                }}
              >
                Workflow Name (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. VIP Abandoned Cart Recovery & Restock"
                value={workflowNameInput}
                onChange={(e) => setWorkflowNameInput(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  background: "#22242a",
                  border: "1px solid #2d2f36",
                  borderRadius: "8px",
                  color: "#fff",
                  fontSize: "0.9rem",
                }}
              />
            </div>

            <div style={{ marginTop: "1rem" }}>
              <label
                style={{
                  display: "block",
                  color: "#e5e7eb",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  marginBottom: "0.5rem",
                }}
              >
                Business Objective
              </label>
              <textarea
                rows={4}
                placeholder="Describe your commerce goal, e.g. 'Recover abandoned carts with value above 2000 BDT, verify inventory stock, and send personalized Banglish offer on WhatsApp.'"
                value={objectiveInput}
                onChange={(e) => setObjectiveInput(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  background: "#22242a",
                  border: "1px solid #2d2f36",
                  borderRadius: "8px",
                  color: "#fff",
                  fontSize: "0.9rem",
                  resize: "vertical",
                }}
              />
            </div>

            {/* Quick Templates */}
            <div style={{ marginTop: "1rem" }}>
              <span style={{ color: "#9ca3af", fontSize: "0.8rem" }}>Quick Patterns:</span>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.4rem" }}>
                {[
                  "Recover abandoned carts with discount offer",
                  "Audit low stock items and calculate reorder quantity",
                  "Review delayed Dhaka delivery exceptions with Pathao",
                  "Process high value bKash refund review",
                ].map((tmpl) => (
                  <button
                    key={tmpl}
                    type="button"
                    onClick={() => setObjectiveInput(tmpl)}
                    style={{
                      background: "#242529",
                      border: "1px solid #33363f",
                      color: "#C7F900",
                      borderRadius: "6px",
                      padding: "0.3rem 0.6rem",
                      fontSize: "0.75rem",
                      cursor: "pointer",
                    }}
                  >
                    {tmpl}
                  </button>
                ))}
              </div>
            </div>

            {/* Simulation Preview */}
            {simulationResult && (
              <div
                style={{
                  marginTop: "1.5rem",
                  padding: "1rem",
                  background: "#1c1d22",
                  border: "1px solid #2d2f36",
                  borderRadius: "10px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "#C7F900", fontWeight: 600, fontSize: "0.85rem" }}>
                    Simulation Projected DAG ({simulationResult.planned_steps.length} Steps)
                  </span>
                  <span style={{ color: "#9ca3af", fontSize: "0.75rem" }}>
                    Est. Cost: ${simulationResult.estimated_cost_usd} USD
                  </span>
                </div>
                <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {simulationResult.planned_steps.map((s: any, idx: number) => (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        fontSize: "0.8rem",
                        color: "#e5e7eb",
                      }}
                    >
                      <span
                        style={{
                          width: "20px",
                          height: "20px",
                          borderRadius: "50%",
                          background: "#2d2f36",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "0.7rem",
                          color: "#9ca3af",
                        }}
                      >
                        {idx + 1}
                      </span>
                      <span style={{ fontWeight: 600, color: "#fff" }}>{s.agent_type}:</span>
                      <span>{s.objective}</span>
                      <Badge variant={s.risk_level === "HIGH" || s.risk_level === "CRITICAL" ? "pending" : "default"}>
                        {s.risk_level}
                      </Badge>
                    </div>
                  ))}
                </div>
                {simulationResult.approval_points?.length > 0 && (
                  <div
                    style={{
                      marginTop: "0.75rem",
                      color: "#f59e0b",
                      fontSize: "0.75rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.4rem",
                    }}
                  >
                    <AlertTriangle size={14} />
                    <span>
                      {simulationResult.approval_points.length} step(s) will require operator approval
                      under policy.
                    </span>
                  </div>
                )}
              </div>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "0.75rem",
                marginTop: "1.5rem",
              }}
            >
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreateModal(false);
                  setSimulationResult(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                onClick={handleSimulate}
                disabled={isSubmitting || !objectiveInput.trim()}
              >
                {isSubmitting ? "Simulating..." : "Simulate Plan"}
              </Button>
              <Button
                variant="primary"
                onClick={handleCreate}
                disabled={isSubmitting || !objectiveInput.trim()}
              >
                {isSubmitting ? "Deploying..." : "Launch Workflow"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
