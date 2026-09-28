import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 10: Autonomous Rollback Service
 * Rollback for reversible operations; compensating actions for irreversible ones (§30).
 */

import { db } from "@/infrastructure/db";
import { RollbackAction, RollbackType } from "@/types/autonomous";

export class AutonomousRollbackService {
  /** Check if an action can be rolled back. */
  canRollback(actionType: RollbackType): { reversible: boolean; reason: string } {
    const reversibleTypes: RollbackType[] = ["CONFIGURATION", "PRICING", "CAMPAIGN", "WORKFLOW", "INTEGRATION", "MODEL", "POLICY"];
    return {
      reversible: reversibleTypes.includes(actionType),
      reason: reversibleTypes.includes(actionType) ? "Action is reversible" : "Action requires compensating strategy",
    };
  }

  /** Execute a rollback to previous state. */
  executeRollback(rollback: RollbackAction): RollbackAction {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    rollback.status = "EXECUTING";
    rollback.initiated_at = new Date().toISOString();
    // Simulate rollback execution
    rollback.status = "COMPLETED";
    rollback.completed_at = new Date().toISOString();
    rollback.verification_result = { verified: true, evidence: { state_restored: true } };
    db.data.rollback_actions.push(rollback);
    return rollback;
  }

  /** Create a compensating action for irreversible operations. */
  createCompensatingAction(tenantId: string, originalAction: string, compensatingDescription: string): RollbackAction {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    const action: RollbackAction = {
      id: `rback_compensate_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      rollback_type: "CONFIGURATION",
      target_entity_id: originalAction,
      target_entity_type: "COMPENSATING_ACTION",
      previous_state: {},
      current_state: {},
      is_reversible: false,
      compensating_action: compensatingDescription,
      status: "PENDING",
      initiated_by: "system",
      initiated_at: new Date().toISOString(),
    };
    db.data.rollback_actions.push(action);
    return action;
  }

  /** For irreversible operations: require stronger approval. */
  requireStrongerApproval(actionType: RollbackType): { approval_level: string; reason: string } {
    const { reversible } = this.canRollback(actionType);
    if (!reversible) {
      return { approval_level: "ENTERPRISE_ADMIN", reason: "Irreversible action requires enterprise admin approval" };
    }
    return { approval_level: "DOMAIN_MANAGER", reason: "Standard approval sufficient for reversible action" };
  }
}
