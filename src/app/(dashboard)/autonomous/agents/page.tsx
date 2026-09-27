"use client";

import React, { useState } from "react";
import {
  Bot,
  RefreshCw,
  Shield,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  Sparkles,
} from "lucide-react";
import styles from "../autonomous.module.css";
import { AutonomousNav } from "../components/AutonomousNav";

interface AutonomousAgentView {
  id: string;
  name: string;
  type: string;
  description: string;
  tier: string;
  capabilities: string[];
  tools: string[];
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  status: "ACTIVE" | "PAUSED";
}

const PHASE_10_AGENTS: AutonomousAgentView[] = [
  {
    id: "agt_supervisor",
    name: "Autonomous Supervisor",
    type: "AUTONOMOUS_SUPERVISOR",
    description: "Master orchestrator decomposing business objectives into cross-domain DAG plans and coordinating specialized agents.",
    tier: "CONVERGENCE",
    capabilities: ["OBJECTIVE_DECOMPOSITION", "CROSS_DOMAIN_ORCHESTRATION", "DAG_SYNTHESIS", "AUTONOMOUS_LOOP_COORDINATION"],
    tools: ["get_autonomous_overview", "get_business_objectives", "pause_domain_autonomy", "execute_autonomous_cycle"],
    risk_level: "HIGH",
    status: "ACTIVE",
  },
  {
    id: "agt_objectives",
    name: "Business Objectives Agent",
    type: "OBJECTIVES_AGENT",
    description: "Manages enterprise business objectives, evaluates multi-tier KPI progress, and assesses achievement risks.",
    tier: "GOVERNANCE",
    capabilities: ["OBJECTIVE_FORMULATION", "HIERARCHY_MANAGEMENT", "PROGRESS_TRACKING", "CONSTRAINT_MONITORING"],
    tools: ["get_business_objectives", "create_business_objective", "simulate_objective_strategy"],
    risk_level: "LOW",
    status: "ACTIVE",
  },
  {
    id: "agt_strategy",
    name: "Strategy Formulation Agent",
    type: "STRATEGY_AGENT",
    description: "Formulates comprehensive multi-agent strategies linked to objectives and simulates strategic tradeoffs.",
    tier: "STRATEGY",
    capabilities: ["STRATEGY_FORMULATION", "TRADEOFF_EVALUATION", "POLICY_ALIGNMENT", "STRATEGY_SIMULATION"],
    tools: ["simulate_objective_strategy", "get_active_strategies", "evaluate_global_decision"],
    risk_level: "LOW",
    status: "ACTIVE",
  },
  {
    id: "agt_decision",
    name: "Global Decision Agent",
    type: "DECISION_AGENT",
    description: "Evaluates cross-domain candidate decisions, asserts policy constraints, and coordinates human governance approvals.",
    tier: "DECISION",
    capabilities: ["DECISION_SCORING", "RISK_ASSESSMENT", "POLICY_VERIFICATION", "APPROVAL_COORDINATION"],
    tools: ["evaluate_global_decision", "approve_autonomous_decision"],
    risk_level: "HIGH",
    status: "ACTIVE",
  },
  {
    id: "agt_learning",
    name: "Continuous Learning Agent",
    type: "LEARNING_AGENT",
    description: "Governs the learning candidate lifecycle (Evaluation → Shadow → Canary → Production) and audits accuracy.",
    tier: "LEARNING",
    capabilities: ["OUTCOME_EVALUATION", "CANDIDATE_SCREENING", "SHADOW_MONITORING", "MODEL_ROLLBACK"],
    tools: ["get_learning_candidates", "evaluate_learning_candidate", "get_quality_scorecard"],
    risk_level: "MEDIUM",
    status: "ACTIVE",
  },
  {
    id: "agt_optimization",
    name: "Multi-Objective Optimization Agent",
    type: "OPTIMIZATION_AGENT",
    description: "Discovers multi-objective optimization opportunities across inventory, pricing, fulfillment, and marketing.",
    tier: "OPTIMIZATION",
    capabilities: ["PARETO_OPTIMIZATION", "CONSTRAINT_SOLVING", "DYNAMIC_OPPORTUNITY_DISCOVERY"],
    tools: ["simulate_objective_strategy", "evaluate_global_decision", "execute_autonomous_cycle"],
    risk_level: "MEDIUM",
    status: "ACTIVE",
  },
  {
    id: "agt_health",
    name: "Platform Health Agent",
    type: "PLATFORM_HEALTH_AGENT",
    description: "Continuously monitors system health across all 11 dimensions, computes the Autonomous Quality Scorecard, and tracks SLOs.",
    tier: "OBSERVABILITY",
    capabilities: ["11_DIMENSION_MONITORING", "QUALITY_SCORECARD_COMPUTATION", "SLO_ERROR_BUDGET_TRACKING"],
    tools: ["get_platform_health", "get_quality_scorecard", "pause_domain_autonomy"],
    risk_level: "LOW",
    status: "ACTIVE",
  },
  {
    id: "agt_economics",
    name: "Platform Economics Agent",
    type: "COST_GOVERNANCE_AGENT",
    description: "Tracks cost-aware autonomy across LLMs, tools, APIs, and workflows; ensures safety boundaries are preserved.",
    tier: "ECONOMICS",
    capabilities: ["COST_PER_DECISION_TRACKING", "TOKEN_EXPENDITURE_AUDITING", "EFFICIENCY_RATIO_ANALYSIS"],
    tools: ["get_platform_costs", "get_quality_scorecard"],
    risk_level: "LOW",
    status: "ACTIVE",
  },
];

export default function AutonomousAgentsPage() {
  const [agents, setAgents] = useState(PHASE_10_AGENTS);

  const toggleAgent = (id: string) => {
    setAgents((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: a.status === "ACTIVE" ? "PAUSED" : "ACTIVE" } : a))
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h1>
            <Bot size={28} color="#c7f900" />
            Agent Control Center
            <span className={styles.headerBadge}>Phase 10</span>
          </h1>
          <p className={styles.headerSubtitle}>
            Specialized autonomous agents collaborating via structured inter-agent protocols with individual risk controls.
          </p>
        </div>
      </div>

      <AutonomousNav />

      <div className={styles.bentoGrid}>
        {agents.map((agt) => (
          <div key={agt.id} className={`${styles.card} ${styles.col6}`}>
            <div className={styles.cardHeader}>
              <div>
                <span className={`${styles.originBadge} ${styles.originAutonomous}`}>{agt.tier}</span>
                <h3 className={styles.cardTitle} style={{ marginTop: 8 }}>{agt.name}</h3>
                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{agt.type}</div>
              </div>
              <span className={`${styles.statusPill} ${agt.status === "ACTIVE" ? styles.statusHealthy : styles.statusCritical}`}>
                {agt.status}
              </span>
            </div>

            <p style={{ fontSize: 13, color: "#9ca3af", marginBottom: 14 }}>{agt.description}</p>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#d1d5db", marginBottom: 4 }}>CAPABILITIES:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {agt.capabilities.map((c) => (
                  <span key={c} style={{ background: "rgba(255,255,255,0.04)", fontSize: 11, padding: "2px 8px", borderRadius: 4, color: "#9ca3af" }}>
                    {c}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#d1d5db", marginBottom: 4 }}>ALLOWED TOOLS:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {agt.tools.map((t) => (
                  <span key={t} style={{ background: "rgba(199,249,0,0.06)", border: "1px solid rgba(199,249,0,0.2)", fontSize: 11, padding: "2px 8px", borderRadius: 4, color: "#c7f900" }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12 }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>
                Risk Ceiling: <strong>{agt.risk_level}</strong>
              </span>
              <button
                className={`${styles.btn} ${agt.status === "ACTIVE" ? styles.btnSecondary : styles.btnPrimary}`}
                onClick={() => toggleAgent(agt.id)}
                style={{ padding: "6px 12px", fontSize: 12 }}
              >
                {agt.status === "ACTIVE" ? "Pause Agent" : "Activate Agent"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
