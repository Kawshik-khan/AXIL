"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  RefreshCw,
  Eye,
  FileText,
  Workflow,
} from "lucide-react";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { Badge } from "@/components/ui/Badge/Badge";
import { Button } from "@/components/ui/Button/Button";
import { LoadingState, EmptyState, ErrorState } from "@/components/ui/States/States";
import { ApprovalRequest, ApprovalStatus } from "@/types/orchestration";

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("PENDING");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [staleBanner, setStaleBanner] = useState<string | null>(null);

  // Reject modal state
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchApprovals = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const url =
        statusFilter === "ALL"
          ? "/api/v1/ai/approvals"
          : `/api/v1/ai/approvals?status=${statusFilter}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to load approval requests");
      setApprovals(data.data || []);
    } catch (err: any) {
      setError(err.message || "Failed to load approval queue");
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  const handleApprove = async (id: string) => {
    setIsSubmitting(true);
    setStaleBanner(null);
    try {
      const res = await fetch(`/api/v1/ai/approvals/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "APPROVE" }),
      });
      const data = await res.json();

      if (res.status === 409 || data.data?.stale) {
        setStaleBanner(
          `Pre-execution validation failed: ${data.data?.reason || "Target entity was modified concurrently since plan formulation."}`
        );
      } else if (!res.ok) {
        alert(data.error?.message || "Failed to approve action");
      }
      fetchApprovals();
    } catch (err: any) {
      alert(err.message || "Error approving request");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!rejectingId) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/ai/approvals/${rejectingId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "REJECT",
          reason: rejectReason.trim() || "Rejected by operator",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to reject action");
      setRejectingId(null);
      setRejectReason("");
      fetchApprovals();
    } catch (err: any) {
      alert(err.message || "Error rejecting request");
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "APPROVED":
        return "success";
      case "PENDING":
        return "pending";
      case "REJECTED":
      case "EXPIRED":
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
          marginBottom: "1.5rem",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#fff", margin: 0 }}>
              Human-in-the-Loop Approvals Queue
            </h1>
            <Badge variant="pending">Controlled Autonomy</Badge>
          </div>
          <p style={{ color: "#9ca3af", margin: "0.25rem 0 0 0", fontSize: "0.95rem" }}>
            Review high-risk actions before autonomous agents execute mutations on orders, payments, or inventory.
          </p>
        </div>

        <Button variant="outline" onClick={fetchApprovals}>
          <RefreshCw size={16} style={{ marginRight: "0.5rem" }} /> Refresh Queue
        </Button>
      </div>

      {/* Stale State Alert Banner */}
      {staleBanner && (
        <div
          style={{
            background: "rgba(239, 68, 68, 0.15)",
            border: "1px solid #ef4444",
            borderRadius: "10px",
            padding: "1rem 1.25rem",
            marginBottom: "1.5rem",
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            color: "#fca5a5",
          }}
        >
          <ShieldAlert size={20} color="#ef4444" />
          <div style={{ flex: 1, fontSize: "0.9rem" }}>{staleBanner}</div>
          <button
            onClick={() => setStaleBanner(null)}
            style={{ background: "transparent", border: "none", color: "#fca5a5", cursor: "pointer" }}
          >
            &times;
          </button>
        </div>
      )}

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
        {["PENDING", "APPROVED", "REJECTED", "EXPIRED", "ALL"].map((tab) => (
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

      {/* Approvals List */}
      {isLoading ? (
        <LoadingState message="Loading approval requests..." />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchApprovals} />
      ) : approvals.length === 0 ? (
        <EmptyState
          title="No Pending Approvals"
          description={
            statusFilter === "PENDING"
              ? "All high-risk autonomous agent actions have been resolved."
              : `No approval requests found matching status: ${statusFilter}`
          }
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {approvals.map((req) => (
            <div
              key={req.id}
              style={{
                background: "#18191c",
                border: "1px solid #2d2f36",
                borderRadius: "12px",
                padding: "1.5rem",
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <span style={{ fontWeight: 700, color: "#fff", fontSize: "1.05rem" }}>
                      {req.action}
                    </span>
                    <Badge variant={req.risk_level === "CRITICAL" ? "suspended" : "pending"}>
                      {req.risk_level} RISK
                    </Badge>
                    <Badge variant="default">{req.target_entity_type}</Badge>
                    <Badge variant={getStatusBadgeVariant(req.status)}>
                      {req.status}
                    </Badge>
                  </div>

                  <p style={{ color: "#e5e7eb", margin: "0.5rem 0 0 0", fontSize: "0.9rem" }}>
                    {req.reason}
                  </p>

                  <div
                    style={{
                      display: "flex",
                      gap: "1.25rem",
                      marginTop: "0.5rem",
                      color: "#6b7280",
                      fontSize: "0.8rem",
                    }}
                  >
                    <span>Agent: <strong style={{ color: "#C7F900" }}>{req.requested_by_agent}</strong></span>
                    <span>Target ID: <code style={{ color: "#38bdf8" }}>{req.target_entity_id}</code></span>
                    <span>
                      Workflow:{" "}
                      <Link
                        href={`/ai/workflows/${req.workflow_id}`}
                        style={{ color: "#C7F900", textDecoration: "underline" }}
                      >
                        {req.workflow_id}
                      </Link>
                    </span>
                    <span>Expires: {new Date(req.expires_at).toLocaleTimeString()}</span>
                  </div>
                </div>

                {/* Actions */}
                {req.status === "PENDING" && (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <Button
                      variant="danger"
                      onClick={() => setRejectingId(req.id)}
                      disabled={isSubmitting}
                    >
                      <XCircle size={15} style={{ marginRight: "0.4rem" }} /> Reject
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => handleApprove(req.id)}
                      disabled={isSubmitting}
                    >
                      <CheckCircle2 size={15} style={{ marginRight: "0.4rem" }} /> Approve & Execute
                    </Button>
                  </div>
                )}
              </div>

              {/* Entity Snapshot / Payload Inspection */}
              {req.payload && Object.keys(req.payload).length > 0 && (
                <div
                  style={{
                    background: "#121316",
                    border: "1px solid #25272e",
                    borderRadius: "8px",
                    padding: "0.75rem 1rem",
                    fontSize: "0.8rem",
                  }}
                >
                  <span style={{ color: "#9ca3af", fontWeight: 600 }}>Proposed Action Payload:</span>
                  <pre style={{ margin: "0.35rem 0 0 0", color: "#d1d5db", overflowX: "auto" }}>
                    {JSON.stringify(req.payload, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Reject Reason Modal */}
      {rejectingId && (
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
              borderRadius: "14px",
              padding: "1.75rem",
              width: "100%",
              maxWidth: "500px",
            }}
          >
            <h3 style={{ margin: 0, color: "#fff", fontSize: "1.2rem", fontWeight: 700 }}>
              Reject Autonomous Action
            </h3>
            <p style={{ color: "#9ca3af", fontSize: "0.85rem", marginTop: "0.25rem" }}>
              Provide a reason for the audit trail and feedback to the autonomous supervisor.
            </p>

            <textarea
              rows={3}
              placeholder="e.g. Customer called to cancel instead, or manual review required."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              style={{
                width: "100%",
                padding: "0.75rem",
                marginTop: "1rem",
                background: "#22242a",
                border: "1px solid #2d2f36",
                borderRadius: "8px",
                color: "#fff",
                fontSize: "0.9rem",
              }}
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.25rem" }}>
              <Button variant="outline" onClick={() => setRejectingId(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleReject} disabled={isSubmitting}>
                Confirm Rejection
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
