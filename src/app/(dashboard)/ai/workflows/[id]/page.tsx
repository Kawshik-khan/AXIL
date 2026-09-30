"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Workflow,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Play,
  Pause,
  RotateCcw,
  XCircle,
  ShieldCheck,
  Cpu,
  Layers,
  FileCode,
  History,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { Badge } from "@/components/ui/Badge/Badge";
import { Button } from "@/components/ui/Button/Button";
import { LoadingState, EmptyState, ErrorState } from "@/components/ui/States/States";

export default function WorkflowDetailPage() {
  // Next 16 hands page params over as a Promise; in a client component useParams() reads them synchronously
  const { id } = useParams<{ id: string }>();

  const [workflow, setWorkflow] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<any>(null);

  const fetchWorkflow = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/ai/workflows/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to load workflow");
      setWorkflow(data.data);
      if (data.data?.tasks?.length > 0 && !selectedTask) {
        setSelectedTask(data.data.tasks[0]);
      }
    } catch (err: any) {
      setError(err.message || "Error fetching workflow details");
    } finally {
      setIsLoading(false);
    }
  }, [id, selectedTask]);

  useEffect(() => {
    fetchWorkflow();
  }, [fetchWorkflow]);

  const handleAction = async (action: string) => {
    try {
      const res = await fetch(`/api/v1/ai/workflows/${id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error?.message || `Failed to perform action: ${action}`);
      }
      fetchWorkflow();
    } catch (err: any) {
      alert(err.message || "Error performing action");
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return "success";
      case "RUNNING":
        return "active";
      case "WAITING":
      case "WAITING_APPROVAL":
        return "pending";
      case "FAILED":
        return "suspended";
      default:
        return "default";
    }
  };

  if (isLoading) return <LoadingState message="Loading DAG execution graph..." />;
  if (error || !workflow) return <ErrorState message={error || "Workflow not found"} onRetry={fetchWorkflow} />;

  const tasks = workflow.tasks || [];
  const checkpoints = workflow.checkpoints || [];
  const messages = workflow.messages || [];

  return (
    <div style={{ width: "100%", paddingBottom: "80px" }}>
      {/* Top Navigation */}
      <div style={{ marginBottom: "1.5rem" }}>
        <Link
          href="/ai/workflows"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            color: "#9ca3af",
            textDecoration: "none",
            fontSize: "0.9rem",
            fontWeight: 500,
          }}
        >
          <ArrowLeft size={16} /> Back to All Workflows
        </Link>
      </div>

      {/* Header Banner */}
      <div
        style={{
          background: "#18191c",
          border: "1px solid #2d2f36",
          borderRadius: "16px",
          padding: "1.5rem 2rem",
          marginBottom: "2rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#fff", margin: 0 }}>
              {workflow.name}
            </h1>
            <Badge variant={getStatusBadgeVariant(workflow.status)}>
              {workflow.status}
            </Badge>
          </div>
          <p style={{ color: "#9ca3af", margin: "0.35rem 0 0 0", fontSize: "0.9rem" }}>
            {workflow.objective}
          </p>
          <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem", color: "#6b7280", fontSize: "0.8rem" }}>
            <span>ID: <code style={{ color: "#C7F900" }}>{workflow.id}</code></span>
            <span>Trigger: {workflow.trigger_type}</span>
            <span>Created: {new Date(workflow.created_at).toLocaleString()}</span>
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {workflow.status === "QUEUED" && (
            <Button variant="primary" onClick={() => handleAction("START")}>
              <Play size={16} style={{ marginRight: "0.4rem" }} /> Start Execution
            </Button>
          )}
          {workflow.status === "RUNNING" && (
            <Button variant="outline" onClick={() => handleAction("PAUSE")}>
              <Pause size={16} style={{ marginRight: "0.4rem" }} /> Pause
            </Button>
          )}
          {(workflow.status === "PAUSED" || workflow.status === "WAITING") && (
            <Button variant="primary" onClick={() => handleAction("RESUME")}>
              <Play size={16} style={{ marginRight: "0.4rem" }} /> Resume
            </Button>
          )}
          {workflow.status === "FAILED" && (
            <Button variant="primary" onClick={() => handleAction("RETRY")}>
              <RotateCcw size={16} style={{ marginRight: "0.4rem" }} /> Retry Failed Steps
            </Button>
          )}
          {workflow.status !== "COMPLETED" && workflow.status !== "CANCELLED" && (
            <Button variant="danger" onClick={() => handleAction("CANCEL")}>
              <XCircle size={16} style={{ marginRight: "0.4rem" }} /> Cancel
            </Button>
          )}
          <Button variant="outline" onClick={fetchWorkflow}>
            <RefreshCw size={16} />
          </Button>
        </div>
      </div>

      {/* Bento Grid: DAG Tasks & Context */}
      <div style={{ marginBottom: "2rem" }}>
        <BentoGrid>
          {/* Column 1: DAG Task Graph */}
          <BentoCard span={8} title={`DAG Tasks (${tasks.length} Steps)`}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1rem" }}>
              {tasks.map((task: any, index: number) => {
                const isSelected = selectedTask?.id === task.id;
                return (
                  <div
                    key={task.id}
                    onClick={() => setSelectedTask(task)}
                    style={{
                      padding: "1rem",
                      borderRadius: "10px",
                      background: isSelected ? "#22242b" : "#1c1d22",
                      border: isSelected ? "1px solid #C7F900" : "1px solid #2d2f36",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                        <span
                          style={{
                            width: "24px",
                            height: "24px",
                            borderRadius: "50%",
                            background: task.status === "COMPLETED" ? "#C7F900" : "#2d2f36",
                            color: task.status === "COMPLETED" ? "#18191c" : "#fff",
                            fontWeight: 700,
                            fontSize: "0.75rem",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {index + 1}
                        </span>
                        <span style={{ fontWeight: 600, color: "#fff", fontSize: "0.9rem" }}>
                          {task.task_type}
                        </span>
                        <span style={{ color: "#C7F900", fontSize: "0.75rem", background: "rgba(199,249,0,0.1)", padding: "0.15rem 0.4rem", borderRadius: "4px" }}>
                          {task.agent_type}
                        </span>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <Badge variant={task.risk_level === "HIGH" || task.risk_level === "CRITICAL" ? "pending" : "default"}>
                          {task.risk_level}
                        </Badge>
                        <Badge variant={getStatusBadgeVariant(task.status)}>
                          {task.status}
                        </Badge>
                      </div>
                    </div>

                    <p style={{ color: "#9ca3af", fontSize: "0.8rem", margin: "0.5rem 0 0 2rem" }}>
                      {task.objective}
                    </p>

                    {task.dependencies?.length > 0 && (
                      <div style={{ marginLeft: "2rem", marginTop: "0.4rem", fontSize: "0.75rem", color: "#6b7280" }}>
                        Depends on: {task.dependencies.map((d: any) => d.task_id).join(", ")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </BentoCard>

          {/* Column 2: Selected Task & Context Inspector */}
          <BentoCard span={4} title="Task Inspector">
            {selectedTask ? (
              <div style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
                <div style={{ borderBottom: "1px solid #2d2f36", paddingBottom: "0.75rem", marginBottom: "0.75rem" }}>
                  <div style={{ color: "#9ca3af", fontSize: "0.75rem" }}>TASK ID</div>
                  <code style={{ color: "#C7F900", fontSize: "0.8rem" }}>{selectedTask.id}</code>
                </div>

                <div style={{ borderBottom: "1px solid #2d2f36", paddingBottom: "0.75rem", marginBottom: "0.75rem" }}>
                  <div style={{ color: "#9ca3af", fontSize: "0.75rem" }}>IDEMPOTENCY KEY</div>
                  <code style={{ color: "#38bdf8", fontSize: "0.8rem" }}>{selectedTask.idempotency_key}</code>
                </div>

                {selectedTask.approval_id && (
                  <div style={{ borderBottom: "1px solid #2d2f36", paddingBottom: "0.75rem", marginBottom: "0.75rem" }}>
                    <div style={{ color: "#9ca3af", fontSize: "0.75rem" }}>APPROVAL REQUIRED</div>
                    <Link href="/ai/approvals" style={{ color: "#f59e0b", fontSize: "0.8rem", textDecoration: "underline" }}>
                      Approval ID: {selectedTask.approval_id} &rarr;
                    </Link>
                  </div>
                )}

                <div style={{ marginBottom: "0.75rem" }}>
                  <div style={{ color: "#9ca3af", fontSize: "0.75rem", marginBottom: "0.25rem" }}>INPUT PAYLOAD</div>
                  <pre
                    style={{
                      background: "#111215",
                      padding: "0.75rem",
                      borderRadius: "6px",
                      color: "#e5e7eb",
                      fontSize: "0.75rem",
                      overflowX: "auto",
                    }}
                  >
                    {JSON.stringify(selectedTask.input, null, 2)}
                  </pre>
                </div>

                {selectedTask.output && (
                  <div>
                    <div style={{ color: "#C7F900", fontSize: "0.75rem", marginBottom: "0.25rem" }}>
                      OUTPUT (VERIFIED)
                    </div>
                    <pre
                      style={{
                        background: "#111215",
                        padding: "0.75rem",
                        borderRadius: "6px",
                        color: "#a7f3d0",
                        fontSize: "0.75rem",
                        overflowX: "auto",
                      }}
                    >
                      {JSON.stringify(selectedTask.output, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ color: "#6b7280", padding: "2rem", textAlign: "center" }}>
                Select a task to inspect inputs and receipts
              </div>
            )}
          </BentoCard>
        </BentoGrid>
      </div>

      {/* Checkpoints & Messages Timeline */}
      <BentoGrid>
        <BentoCard span={6} title="Durable Checkpoints Snapshot">
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.75rem" }}>
            {checkpoints.length === 0 ? (
              <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>No checkpoints recorded yet.</div>
            ) : (
              checkpoints.map((chk: any) => (
                <div
                  key={chk.id}
                  style={{
                    padding: "0.6rem 0.75rem",
                    background: "#1c1d22",
                    borderRadius: "6px",
                    border: "1px solid #2d2f36",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: "0.8rem",
                  }}
                >
                  <div>
                    <span style={{ color: "#fff", fontWeight: 600 }}>Step {chk.step_index}: </span>
                    <span style={{ color: "#9ca3af" }}>{chk.reason}</span>
                  </div>
                  <span style={{ color: "#6b7280", fontSize: "0.75rem" }}>
                    {new Date(chk.created_at).toLocaleTimeString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </BentoCard>

        <BentoCard span={6} title="Inter-Agent Communication Bus">
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.75rem" }}>
            {messages.length === 0 ? (
              <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>No messages logged yet.</div>
            ) : (
              messages.map((msg: any) => (
                <div
                  key={msg.id}
                  style={{
                    padding: "0.6rem 0.75rem",
                    background: "#1c1d22",
                    borderRadius: "6px",
                    border: "1px solid #2d2f36",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: "0.8rem",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ color: "#C7F900", fontWeight: 600 }}>{msg.sender_agent}</span>
                    <span style={{ color: "#6b7280" }}>&rarr;</span>
                    <span style={{ color: "#38bdf8", fontWeight: 600 }}>{msg.recipient_agent}</span>
                    <Badge variant="default">{msg.message_type}</Badge>
                  </div>
                  <span style={{ color: "#6b7280", fontSize: "0.75rem" }}>
                    {new Date(msg.created_at).toLocaleTimeString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </BentoCard>
      </BentoGrid>
    </div>
  );
}
