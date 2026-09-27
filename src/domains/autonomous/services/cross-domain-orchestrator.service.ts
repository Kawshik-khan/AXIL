/**
 * CommerceOS Phase 10: Cross-Domain Orchestrator Service
 * Structured inter-agent protocol, cross-domain routing, conflict resolution,
 * and 6 canonical cross-domain business workflows.
 */

import { db } from "@/infrastructure/db";
import {
  CrossDomainAgentMessage,
  AgentProposal,
  AgentConflict,
  AgentConflictResolutionStrategy,
  AutonomousWorkflowType,
} from "@/types/autonomous";
import { AgentType } from "@/types/ai";

export class CrossDomainOrchestratorService {
  /**
   * Route a structured message between domain agents.
   */
  routeAgentMessage(message: CrossDomainAgentMessage): CrossDomainAgentMessage {
    message.created_at = new Date().toISOString();
    db.data.cross_domain_messages.push(message);
    return message;
  }

  /**
   * Create a proposal from one agent to others for collaborative action.
   */
  createProposal(proposal: AgentProposal): AgentProposal {
    proposal.status = "PENDING";
    proposal.created_at = new Date().toISOString();
    db.data.agent_proposals.push(proposal);
    return proposal;
  }

  /**
   * Cast a vote on an existing proposal.
   */
  voteOnProposal(
    tenantId: string,
    proposalId: string,
    vote: { agent: AgentType; vote: "APPROVE" | "REJECT" | "ABSTAIN" | "COUNTER_PROPOSE"; reason: string }
  ): AgentProposal {
    const proposal = db.data.agent_proposals.find(
      (p) => p.id === proposalId && p.tenant_id === tenantId
    );
    if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
    proposal.votes.push(vote);

    // Auto-resolve if all target agents have voted
    const allVoted = proposal.target_agents.every((agent) =>
      proposal.votes.some((v) => v.agent === agent)
    );
    if (allVoted) {
      const approvals = proposal.votes.filter((v) => v.vote === "APPROVE").length;
      const rejections = proposal.votes.filter((v) => v.vote === "REJECT").length;
      proposal.status = approvals > rejections ? "ACCEPTED" : "REJECTED";
      proposal.resolved_at = new Date().toISOString();
    }
    return proposal;
  }

  /**
   * Detect and record a conflict between agents.
   */
  detectConflict(conflict: AgentConflict): AgentConflict {
    conflict.status = "DETECTED";
    conflict.created_at = new Date().toISOString();
    db.data.agent_conflicts.push(conflict);
    return conflict;
  }

  /**
   * Resolve a conflict using the specified resolution strategy.
   */
  resolveConflict(
    tenantId: string,
    conflictId: string,
    strategy: AgentConflictResolutionStrategy,
    resolvedBy: string
  ): AgentConflict {
    const conflict = db.data.agent_conflicts.find(
      (c) => c.id === conflictId && c.tenant_id === tenantId
    );
    if (!conflict) throw new Error(`Conflict not found: ${conflictId}`);

    conflict.resolution_strategy = strategy;
    let winner: AgentType | undefined;
    let decision = "";

    switch (strategy) {
      case "PRIORITY_WINS":
        const sorted = [...conflict.agent_positions].sort((a, b) => a.priority - b.priority);
        winner = sorted[0]?.agent;
        decision = `Agent ${winner} wins by priority`;
        break;
      case "CONSTRAINT_WINS":
        decision = "Most constrained position adopted";
        break;
      case "NEGOTIATION":
        decision = "Agents negotiate a compromise";
        break;
      case "HUMAN_DECIDES":
        conflict.status = "ESCALATED";
        decision = "Escalated to human operator for resolution";
        conflict.resolved_at = new Date().toISOString();
        return conflict;
      case "SIMULATION_DECIDES":
        decision = "Simulation determines best outcome";
        break;
    }

    conflict.resolution = { winner, decision, rationale: `Resolved via ${strategy}`, resolved_by: resolvedBy };
    conflict.status = "RESOLVED";
    conflict.resolved_at = new Date().toISOString();
    return conflict;
  }

  /**
   * Get canonical workflow definition for the specified type.
   */
  getWorkflowDefinition(workflowType: AutonomousWorkflowType): {
    name: string;
    domains: string[];
    agents: AgentType[];
    steps: string[];
  } {
    const definitions: Record<string, { name: string; domains: string[]; agents: AgentType[]; steps: string[] }> = {
      DEMAND_SURGE_RESPONSE: {
        name: "Demand Surge Response",
        domains: ["INVENTORY", "PROCUREMENT", "PRICING", "MARKETING", "FULFILLMENT", "FINANCE"],
        agents: ["INVENTORY_INTELLIGENCE", "PROCUREMENT", "PRICING_OPERATIONS", "CAMPAIGN_PLANNER", "FULFILLMENT", "FINANCE_OPERATIONS"],
        steps: ["DETECT_DEMAND_SURGE", "FORECAST_IMPACT", "EVALUATE_INVENTORY_RISK", "EVALUATE_PROCUREMENT", "EVALUATE_PRICING", "EVALUATE_MARKETING", "EVALUATE_CAPACITY", "EVALUATE_MARGIN", "SIMULATE_COMBINED", "POLICY_CHECK", "APPROVAL", "EXECUTE", "VERIFY", "MEASURE"],
      },
      INVENTORY_CRISIS_RECOVERY: {
        name: "Inventory Crisis Recovery",
        domains: ["INVENTORY", "PROCUREMENT", "PRICING", "MARKETING"],
        agents: ["INVENTORY_OPERATIONS", "PROCUREMENT", "PRICING_OPERATIONS", "CAMPAIGN_PLANNER"],
        steps: ["IDENTIFY_STOCKOUT_RISK", "IDENTIFY_AFFECTED_STORES", "TRANSFER_ANALYSIS", "PROCUREMENT_ANALYSIS", "DEMAND_ANALYSIS", "PRICING_PROMOTION_ANALYSIS", "CUSTOMER_IMPACT", "SIMULATE", "EXECUTE_AUTHORIZED", "VERIFY"],
      },
      PROFIT_OPTIMIZATION: {
        name: "Profit Optimization",
        domains: ["PRICING", "MARKETING", "PROCUREMENT", "OPERATIONS"],
        agents: ["PRICING_OPERATIONS", "CAMPAIGN_PLANNER", "PROCUREMENT", "OPERATIONS_OPTIMIZATION"],
        steps: ["DETECT_MARGIN_DECLINE", "PRODUCT_ANALYSIS", "PRICING_ANALYSIS", "DISCOUNT_ANALYSIS", "PROCUREMENT_COST", "MARKETING_EFFICIENCY", "OPERATIONAL_COST", "SIMULATION", "STRATEGY", "POLICY", "EXECUTION", "MEASUREMENT"],
      },
      CUSTOMER_RETENTION_RECOVERY: {
        name: "Customer Retention Recovery",
        domains: ["GROWTH", "MARKETING", "SUPPORT", "INTELLIGENCE"],
        agents: ["RETENTION_AGENT", "CUSTOMER_LIFECYCLE", "CAMPAIGN_PLANNER", "CUSTOMER_INTELLIGENCE"],
        steps: ["DETECT_RETENTION_DECLINE", "CUSTOMER_INTELLIGENCE", "LIFECYCLE_SEGMENTATION", "CHURN_PREDICTION", "PRODUCT_AFFINITY", "OFFER_STRATEGY", "CAMPAIGN", "SUPPORT_INTERVENTION", "EXPERIMENT", "ATTRIBUTION", "OPTIMIZATION"],
      },
      OPERATIONAL_CRISIS_MANAGEMENT: {
        name: "Operational Crisis Management",
        domains: ["OPERATIONS", "SUPPORT", "FULFILLMENT", "SHIPPING"],
        agents: ["OPERATIONS_SUPERVISOR", "EXCEPTION_MANAGEMENT", "FULFILLMENT", "SHIPPING_OPERATIONS"],
        steps: ["DETECT_CRITICAL_EXCEPTION", "CREATE_INCIDENT", "CROSS_DOMAIN_DIAGNOSIS", "AGENT_COLLABORATION", "RECOVERY_OPTIONS", "SIMULATION", "POLICY_CHECK", "HUMAN_APPROVAL", "EXECUTE", "VERIFY", "POSTMORTEM", "LEARNING"],
      },
      ENTERPRISE_EXPANSION: {
        name: "Enterprise Expansion",
        domains: ["INTELLIGENCE", "INVENTORY", "PRICING", "MARKETING", "FULFILLMENT", "FINANCE"],
        agents: ["ENTERPRISE_INTELLIGENCE", "INVENTORY_OPERATIONS", "PRICING_OPERATIONS", "CAMPAIGN_PLANNER", "FULFILLMENT", "FINANCE_OPERATIONS"],
        steps: ["DEMAND_ANALYSIS", "PRODUCT_SELECTION", "INVENTORY_PLANNING", "PRICING", "MARKETING", "LOGISTICS", "PAYMENT_PROVIDERS", "SUPPORT", "FINANCE", "INTEGRATION_READINESS", "LAUNCH_PLAN", "APPROVAL", "CONTROLLED_ROLLOUT", "MONITORING"],
      },
    };

    return definitions[workflowType] || {
      name: workflowType,
      domains: [],
      agents: [],
      steps: ["OBSERVE", "UNDERSTAND", "PLAN", "EXECUTE", "VERIFY", "LEARN"],
    };
  }

  /**
   * Get messages by correlation ID for tracing cross-domain conversations.
   */
  getMessagesByCorrelation(tenantId: string, correlationId: string): CrossDomainAgentMessage[] {
    return db.data.cross_domain_messages.filter(
      (m) => m.tenant_id === tenantId && m.correlation_id === correlationId
    );
  }

  /**
   * Get active conflicts for a tenant.
   */
  getActiveConflicts(tenantId: string): AgentConflict[] {
    return db.data.agent_conflicts.filter(
      (c) => c.tenant_id === tenantId && (c.status === "DETECTED" || c.status === "MEDIATING")
    );
  }
}
