/**
 * The one server-side check for privileged platform actions (super-admin console plan §5.2): permission → step-up →
 * reason/ticket → two-person approval bound to the exact input. Fails closed with STEP_UP_REQUIRED or
 * APPROVAL_REQUIRED (rules/privileged-actions.md §3.4); the console reads those codes to ask for the next step.
 */
import type { PlatformContext, PlatformPermission } from "@/lib/context";
import { AppError } from "@/lib/errors";
import type { PlatformApprovalRequestRecord } from "@/types/platform";
import { approvalRequired, findPrivilegedAction, type PrivilegedActionSpec } from "../privileged-actions";
import { PlatformAuthorizationService } from "./platform-authorization.service";
import { PlatformApprovalService, payloadHash } from "./platform-approval.service";

export interface GateInput {
  reason?: string;
  ticketRef?: string;
  /** The approval request this execution uses, when the action needs one. */
  approvalId?: string;
  /** The exact action input; an approval must have been granted for the same input. */
  payload: Record<string, unknown>;
  /** Facts that decide conditional approval policies. */
  facts?: { tenantCreatedAt?: string; affectedCount?: number; countThreshold?: number };
  /** The typed confirmation for CRITICAL actions, checked against the spec's phrase. */
  confirmation?: string;
  confirmTarget?: { slug?: string; id: string };
}

export interface GateResult {
  spec: PrivilegedActionSpec;
  approval: PlatformApprovalRequestRecord | null;
}

export class PrivilegedActionGate {
  public static assert(context: PlatformContext, actionKey: string, input: GateInput): GateResult {
    const spec = findPrivilegedAction(actionKey);
    if (!spec) throw new AppError("UNKNOWN_ACTION", `"${actionKey}" is not a declared privileged action.`, 500);

    PlatformAuthorizationService.assertCan(context, spec.permission as PlatformPermission);
    if (spec.stepUp) PlatformAuthorizationService.assertStepUp(context, spec.key);

    const reason = input.reason?.trim() ?? "";
    if (spec.reasonMin > 0 && reason.length < spec.reasonMin) {
      throw new AppError("REASON_REQUIRED", `"${spec.label}" needs a reason of at least ${spec.reasonMin} characters.`, 400);
    }
    if (spec.ticketRequired && !input.ticketRef?.trim()) {
      throw new AppError("TICKET_REQUIRED", `"${spec.label}" needs a ticket or incident reference.`, 400);
    }
    if (spec.confirmPhrase) {
      const expected = spec.confirmPhrase(input.confirmTarget ?? { id: "" });
      if (input.confirmation !== expected) {
        throw new AppError("CONFIRMATION_REQUIRED", `Type "${expected}" to confirm.`, 400, { expected });
      }
    }

    if (!approvalRequired(spec, input.facts)) return { spec, approval: null };

    if (!input.approvalId) {
      throw new AppError(
        "APPROVAL_REQUIRED",
        `"${spec.label}" needs a second operator's approval before it can run.`,
        403,
        // The console requests approval for exactly this input (the same non-secret data the caller just sent)
        { action_key: spec.key, payload: input.payload, payload_hash: payloadHash(input.payload) }
      );
    }
    const approval = PlatformApprovalService.consumeForExecution(context, input.approvalId, spec.key, input.payload);
    return { spec, approval };
  }
}
