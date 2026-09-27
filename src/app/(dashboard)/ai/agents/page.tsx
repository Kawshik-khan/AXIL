"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Bot,
  ShieldAlert,
  ShieldCheck,
  Zap,
  Clock,
  Sliders,
  AlertTriangle,
  RefreshCw,
  Power,
  Settings,
} from "lucide-react";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { Badge } from "@/components/ui/Badge/Badge";
import { Button } from "@/components/ui/Button/Button";
import { LoadingState, EmptyState, ErrorState } from "@/components/ui/States/States";
import { AutonomyLevel, ActionRiskLevel } from "@/types/orchestration";

const AUTONOMY_LEVEL_LABELS: Record<string, string> = {
  LEVEL_0_DISABLED: "Level 0: Disabled (Read-only)",
  LEVEL_1_COPILOT: "Level 1: Copilot (Manual Approvals)",
  LEVEL_2_ASSISTED: "Level 2: Assisted (Low Risk Auto)",
  LEVEL_3_CONDITIONAL: "Level 3: Conditional (Policy Governed)",
  LEVEL_4_HIGH: "Level 4: High Autonomy (Bounded)",
};

export default function AgentsRegistryPage() {
  const [agents, setAgents] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingAgent, setUpdatingAgent] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/ai/agents?view=orchestration");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to load agent capability registry");
      setAgents(data.data || []);
    } catch (err: any) {
      setError(err.message || "Failed to load agents");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const handleToggleKillSwitch = async (agentType: string, isCurrentlyStopped: boolean) => {
    setUpdatingAgent(agentType);
    try {
      const action = isCurrentlyStopped ? "CLEAR_KILL_SWITCH" : "TRIGGER_KILL_SWITCH";
      const res = await fetch("/api/v1/ai/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, agent_type: agentType }),
      });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error?.message || "Failed to toggle kill switch");
      }
      fetchAgents();
    } catch (err: any) {
      alert(err.message || "Error updating kill switch");
    } finally {
      setUpdatingAgent(null);
    }
  };

  const handleUpdateAutonomyLevel = async (agentType: string, newLevel: string) => {
    setUpdatingAgent(agentType);
    try {
      const res = await fetch("/api/v1/ai/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "UPDATE_POLICY",
          agent_type: agentType,
          autonomy_level: newLevel,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error?.message || "Failed to update autonomy policy");
      }
      fetchAgents();
    } catch (err: any) {
      alert(err.message || "Error updating autonomy level");
    } finally {
      setUpdatingAgent(null);
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
              Agent Capability Registry & Autonomy Policies
            </h1>
            <Badge variant="active">Phase 5</Badge>
          </div>
          <p style={{ color: "#9ca3af", margin: "0.25rem 0 0 0", fontSize: "0.95rem" }}>
            Configure individual agent autonomy levels, safety thresholds, and emergency kill switches.
          </p>
        </div>

        <Button variant="outline" onClick={fetchAgents}>
          <RefreshCw size={16} style={{ marginRight: "0.5rem" }} /> Refresh Registry
        </Button>
      </div>

      {isLoading ? (
        <LoadingState message="Loading agent capability registry..." />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchAgents} />
      ) : (
        <BentoGrid>
          {agents.map((agent) => {
            const policy = agent.policy;
            const isStopped = policy?.is_emergency_stopped;

            return (
              <BentoCard
                key={agent.agent_type}
                span={6}
                title={agent.name}
                action={
                  <Badge variant={isStopped ? "suspended" : agent.enabled ? "success" : "inactive"}>
                    {isStopped ? "STOPPED" : agent.enabled ? "ACTIVE" : "DISABLED"}
                  </Badge>
                }
              >
                <div style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
                  <p style={{ color: "#9ca3af", margin: 0, minHeight: "2.5rem" }}>
                    {agent.description}
                  </p>

                  {/* Capabilities List */}
                  <div style={{ marginTop: "1rem" }}>
                    <span style={{ color: "#6b7280", fontSize: "0.75rem", fontWeight: 600 }}>
                      DECLARED CAPABILITIES:
                    </span>
                    <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.35rem" }}>
                      {agent.capabilities?.map((cap: string) => (
                        <span
                          key={cap}
                          style={{
                            background: "#22242a",
                            border: "1px solid #2d2f36",
                            padding: "0.15rem 0.4rem",
                            borderRadius: "4px",
                            color: "#C7F900",
                            fontSize: "0.75rem",
                          }}
                        >
                          {cap}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Policy & Autonomy Controls */}
                  <div
                    style={{
                      marginTop: "1.25rem",
                      background: "#1c1d22",
                      border: "1px solid #2d2f36",
                      borderRadius: "10px",
                      padding: "1rem",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <label style={{ color: "#e5e7eb", fontWeight: 600, fontSize: "0.8rem" }}>
                        AUTONOMY LEVEL
                      </label>
                      <span style={{ color: "#9ca3af", fontSize: "0.75rem" }}>
                        Max Risk: <strong style={{ color: "#fff" }}>{agent.max_risk_level}</strong>
                      </span>
                    </div>

                    <select
                      value={policy?.autonomy_level || "LEVEL_2_ASSISTED"}
                      onChange={(e) => handleUpdateAutonomyLevel(agent.agent_type, e.target.value)}
                      disabled={updatingAgent === agent.agent_type || isStopped}
                      style={{
                        width: "100%",
                        padding: "0.5rem",
                        marginTop: "0.5rem",
                        background: "#111215",
                        border: "1px solid #33363f",
                        borderRadius: "6px",
                        color: "#fff",
                        fontSize: "0.85rem",
                      }}
                    >
                      {Object.entries(AUTONOMY_LEVEL_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>
                          {label}
                        </option>
                      ))}
                    </select>

                    {/* Kill Switch Toggle */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginTop: "1rem",
                        paddingTop: "0.75rem",
                        borderTop: "1px solid #272930",
                      }}
                    >
                      <div>
                        <span style={{ fontWeight: 600, color: isStopped ? "#ef4444" : "#fff" }}>
                          Emergency Kill Switch
                        </span>
                        <div style={{ color: "#6b7280", fontSize: "0.75rem" }}>
                          Instantly halt all execution for {agent.agent_type}
                        </div>
                      </div>

                      <Button
                        variant={isStopped ? "primary" : "danger"}
                        onClick={() => handleToggleKillSwitch(agent.agent_type, isStopped)}
                        disabled={updatingAgent === agent.agent_type}
                      >
                        <Power size={14} style={{ marginRight: "0.4rem" }} />
                        {isStopped ? "Clear Stop" : "Trigger Stop"}
                      </Button>
                    </div>
                  </div>

                  {/* Operational Limits */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginTop: "0.75rem",
                      fontSize: "0.75rem",
                      color: "#6b7280",
                    }}
                  >
                    <span>Timeout: {agent.timeout_ms / 1000}s</span>
                    <span>Daily Quota: {policy?.max_actions_per_day ?? 100} actions</span>
                    <span>Spend Limit: ${policy?.max_cost_usd_per_day ?? 5.0} USD</span>
                  </div>
                </div>
              </BentoCard>
            );
          })}
        </BentoGrid>
      )}
    </div>
  );
}
