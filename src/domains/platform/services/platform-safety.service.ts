import { db } from "@/infrastructure/db";
import { PlatformKillSwitchRecord } from "@/types/platform";
import { PlatformContext } from "@/lib/context";
import { PlatformAuthorizationService } from "./platform-authorization.service";
import { PlatformAuditService } from "./platform-audit.service";
import { AppError, NotFoundError } from "@/lib/errors";

export class PlatformSafetyService {
  /**
   * Retrieves all registered kill switches.
   */
  public static getKillSwitches(context: PlatformContext): PlatformKillSwitchRecord[] {
    PlatformAuthorizationService.assertCan(context, "security.read");
    return db.getPlatformKillSwitches();
  }

  /**
   * Activates an emergency kill switch for a designated scope.
   * Requires: CRITICAL permission ("security.manage"), step-up verification, and descriptive reason.
   */
  public static activateKillSwitch(
    input: {
      scope: "GLOBAL" | "TENANT" | "WORKFLOW" | "PROVIDER" | "CHANNEL" | "ENVIRONMENT";
      targetId?: string;
      reason: string;
    },
    context: PlatformContext
  ): PlatformKillSwitchRecord {
    PlatformAuthorizationService.assertCan(context, "security.manage");
    PlatformAuthorizationService.assertStepUp(context, "kill_switch.activate");

    if (!input.reason || input.reason.trim().length < 8) {
      throw new AppError("REASON_REQUIRED", "Activating an emergency kill switch requires an incident reason (min 8 chars).", 400);
    }

    const id = input.scope === "GLOBAL" ? "KILL_SWITCH_GLOBAL" : `KILL_SWITCH_${input.scope}_${input.targetId || "ALL"}`;
    const now = new Date().toISOString();

    const existing = db.findPlatformKillSwitch(id);
    const beforeState = existing ? { is_active: existing.is_active } : null;

    const killSwitch: PlatformKillSwitchRecord = {
      id,
      scope: input.scope,
      target_id: input.targetId,
      is_active: true,
      reason: input.reason,
      activated_by_user_id: context.platformUser.id,
      activated_at: now,
      updated_at: now,
    };

    db.savePlatformKillSwitch(killSwitch);

    // Also record security event
    db.recordPlatformSecurityEvent({
      id: `sec_evt_${Math.random().toString(36).substring(2, 10)}`,
      event_type: "KILL_SWITCH_TRIGGERED",
      severity: "CRITICAL",
      actor_id: context.platformUser.id,
      target_tenant_id: input.scope === "TENANT" ? input.targetId : undefined,
      description: `Emergency Kill Switch activated: ${id}. Reason: ${input.reason}`,
      created_at: now,
    });

    PlatformAuditService.record(
      {
        action: "kill_switch.activate",
        resource_type: "kill_switch",
        resource_id: id,
        target_tenant_id: input.scope === "TENANT" ? input.targetId : undefined,
        reason: input.reason,
        before_state: beforeState,
        after_state: { is_active: true, scope: input.scope, targetId: input.targetId },
        result: "SUCCESS",
      },
      context
    );

    return killSwitch;
  }

  /**
   * Deactivates a kill switch, restoring operations.
   */
  public static deactivateKillSwitch(id: string, reason: string, context: PlatformContext): PlatformKillSwitchRecord {
    PlatformAuthorizationService.assertCan(context, "security.manage");
    PlatformAuthorizationService.assertStepUp(context, "kill_switch.deactivate");

    const existing = db.findPlatformKillSwitch(id);
    if (!existing) throw new NotFoundError(`Kill switch "${id}" not found.`);

    const now = new Date().toISOString();
    const beforeState = { is_active: existing.is_active };

    existing.is_active = false;
    existing.deactivated_by_user_id = context.platformUser.id;
    existing.deactivated_at = now;
    existing.updated_at = now;

    db.savePlatformKillSwitch(existing);

    PlatformAuditService.record(
      {
        action: "kill_switch.deactivate",
        resource_type: "kill_switch",
        resource_id: id,
        reason: reason || "Emergency kill switch cleared after incident resolution",
        before_state: beforeState,
        after_state: { is_active: false, deactivated_at: now },
        result: "SUCCESS",
      },
      context
    );

    return existing;
  }

  /**
   * Fast check used by automation engines and routers to verify if an operation is blocked.
   */
  public static isExecutionBlocked(scope: string, targetId?: string): boolean {
    const switches = db.getPlatformKillSwitches();
    const globalSwitch = switches.find((s) => s.id === "KILL_SWITCH_GLOBAL" && s.is_active);
    if (globalSwitch) return true;

    if (scope && targetId) {
      const scopedSwitch = switches.find(
        (s) => s.scope === scope && s.target_id === targetId && s.is_active
      );
      if (scopedSwitch) return true;
    }

    return false;
  }
}
