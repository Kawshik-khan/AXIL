import { randomSuffix } from "@/lib/ids";
import {
  AutonomyPolicy,
  AutonomyLevel,
  ActionRiskLevel,
} from '@/types/orchestration';
import { AgentType } from '@/types/ai';
import { db } from '@/infrastructure/db';

export class AutonomyPolicyService {
  /**
   * Returns default autonomy policy for an agent
   */
  public getDefaultPolicy(tenantId: string, agentType: AgentType): AutonomyPolicy {
    const now = new Date().toISOString();
    return {
      id: `pol_${tenantId}_${agentType.toLowerCase()}`,
      tenant_id: tenantId,
      agent_type: agentType,
      autonomy_level: AutonomyLevel.LEVEL_2_ASSISTED,
      allowed_tools: [],
      approval_required_for: [ActionRiskLevel.HIGH, ActionRiskLevel.CRITICAL],
      max_actions_per_day: 100,
      max_cost_usd_per_day: 5.0,
      max_duration_ms: 60000,
      allowed_channels: ["IN_APP", "WHATSAPP", "FACEBOOK"],
      is_emergency_stopped: false,
      enabled: true,
      version: 1,
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * Retrieves or initializes tenant autonomy policy for an agent
   */
  public getPolicy(tenantId: string, agentType: AgentType): AutonomyPolicy {
    let policy = db.getAutonomyPolicy(tenantId, agentType);
    if (!policy) {
      policy = this.getDefaultPolicy(tenantId, agentType);
      db.upsertAutonomyPolicy(policy);
    }
    return policy;
  }

  /**
   * Evaluates if a planned action requires human approval
   */
  public requiresApproval(
    tenantId: string,
    agentType: AgentType,
    riskLevel: ActionRiskLevel
  ): boolean {
    const policy = this.getPolicy(tenantId, agentType);

    // If emergency stopped or disabled, block execution
    if (policy.is_emergency_stopped || !policy.enabled) {
      return true;
    }

    switch (policy.autonomy_level) {
      case AutonomyLevel.LEVEL_0_DISABLED:
        return true;
      case AutonomyLevel.LEVEL_1_COPILOT:
        return true; // Human must approve every action
      case AutonomyLevel.LEVEL_2_ASSISTED:
        return riskLevel !== ActionRiskLevel.LOW;
      case AutonomyLevel.LEVEL_3_CONDITIONAL:
        return (
          riskLevel === ActionRiskLevel.HIGH || riskLevel === ActionRiskLevel.CRITICAL
        );
      case AutonomyLevel.LEVEL_4_HIGH:
        return riskLevel === ActionRiskLevel.CRITICAL; // Critical always requires approval
      default:
        return true;
    }
  }

  /**
   * Emergency Kill Switch: immediately halts an agent's autonomous execution
   */
  public triggerEmergencyStop(tenantId: string, agentType: AgentType, reason: string): AutonomyPolicy {
    const policy = this.getPolicy(tenantId, agentType);
    policy.is_emergency_stopped = true;
    policy.updated_at = new Date().toISOString();
    db.upsertAutonomyPolicy(policy);

    // Record audit log
    db.createAuditLog({
      id: `aud_killswitch_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      actor_user_id: "ADMIN",
      action: "EMERGENCY_STOP_TRIGGERED",
      resource_type: "agent_policy",
      resource_id: policy.id,
      metadata: { agent_type: agentType, reason },
      created_at: new Date().toISOString(),
    });

    return policy;
  }

  /**
   * Clears Emergency Kill Switch for an agent
   */
  public clearEmergencyStop(tenantId: string, agentType: AgentType): AutonomyPolicy {
    const policy = this.getPolicy(tenantId, agentType);
    policy.is_emergency_stopped = false;
    policy.updated_at = new Date().toISOString();
    db.upsertAutonomyPolicy(policy);

    db.createAuditLog({
      id: `aud_killswitch_cleared_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      actor_user_id: "ADMIN",
      action: "EMERGENCY_STOP_CLEARED",
      resource_type: "agent_policy",
      resource_id: policy.id,
      metadata: { agent_type: agentType },
      created_at: new Date().toISOString(),
    });

    return policy;
  }

  /**
   * Evaluates action risk level dynamically based on action and entity
   */
  public classifyRisk(action: string, entityType: string, params?: Record<string, any>): ActionRiskLevel {
    const act = action.toUpperCase();

    // Critical Risks
    if (act.includes("DELETE") || act.includes("PURGE") || act.includes("WIPE") || act.includes("RESET")) {
      return ActionRiskLevel.CRITICAL;
    }
    if (act.includes("REFUND") && params?.amount && Number(params.amount) > 5000) {
      return ActionRiskLevel.CRITICAL;
    }

    // High Risks
    if (act.includes("CANCEL") || act.includes("REFUND") || act.includes("WRITE_OFF") || act.includes("BROADCAST")) {
      return ActionRiskLevel.HIGH;
    }

    // Medium Risks
    if (
      act.includes("CREATE") ||
      act.includes("UPDATE") ||
      act.includes("DISCOUNT") ||
      act.includes("COUPON") ||
      act.includes("ADDRESS")
    ) {
      return ActionRiskLevel.MEDIUM;
    }

    // Low Risks
    return ActionRiskLevel.LOW;
  }
}

export const autonomyPolicyService = new AutonomyPolicyService();
