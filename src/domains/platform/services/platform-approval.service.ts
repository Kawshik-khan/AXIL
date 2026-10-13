/**
 * Two-person approval for privileged platform actions (super-admin console plan §5.5, rules/privileged-actions.md
 * §3.3). A request binds the exact action input (canonical SHA-256); a second operator approves or rejects it with
 * step-up; the requester then executes the action once, presenting the same input. Expiry is derived on read.
 */
import crypto from "crypto";
import { db } from "@/infrastructure/db";
import type { PlatformApprovalRequestRecord, PlatformApprovalStatus } from "@/types/platform";
import type { PlatformContext, PlatformPermission } from "@/lib/context";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { randomSuffix } from "@/lib/ids";
import { PLATFORM_ROLE_PERMISSIONS } from "@/lib/permissions";
import { PlatformAuthorizationService } from "./platform-authorization.service";
import { PlatformAuditService } from "./platform-audit.service";
import { PlatformSettingsService } from "./platform-settings.service";
import { findPrivilegedAction, type PrivilegedActionSpec } from "../privileged-actions";

/** What the console shows: the stored status, or EXPIRED once a PENDING/APPROVED request is past its expiry. */
export type ApprovalEffectiveStatus = PlatformApprovalStatus | "EXPIRED";

export interface ApprovalView extends PlatformApprovalRequestRecord {
  effective_status: ApprovalEffectiveStatus;
  action_label: string;
  risk: PrivilegedActionSpec["risk"];
  /** Whether the caller may approve/reject it now (holds the permissions, isn't the requester, still pending). */
  can_decide: boolean;
  /** Whether the caller may execute it now (the requester, approved, unexpired). */
  can_execute: boolean;
}

/** Stable JSON: object keys sorted at every level, so the same input always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** The approver must still be an active operator holding approval.decide and the action's permission. */
function approverStillEntitled(record: PlatformApprovalRequestRecord): boolean {
  if (!record.decided_by) return false;
  const membership = db.findPlatformMembershipByUserId(record.decided_by);
  if (!membership || !membership.is_active) return false;
  const perms: readonly string[] = PLATFORM_ROLE_PERMISSIONS[membership.role] ?? [];
  const spec = findPrivilegedAction(record.action_key);
  return perms.includes("approval.decide") && Boolean(spec && perms.includes(spec.permission));
}

export function payloadHash(payload: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function effectiveStatus(record: PlatformApprovalRequestRecord, now: number): ApprovalEffectiveStatus {
  if ((record.status === "PENDING" || record.status === "APPROVED") && Date.parse(record.expires_at) <= now) return "EXPIRED";
  return record.status;
}

function specOrThrow(actionKey: string): PrivilegedActionSpec {
  const spec = findPrivilegedAction(actionKey);
  if (!spec) throw new AppError("UNKNOWN_ACTION", `"${actionKey}" is not a privileged platform action.`, 400);
  if (spec.approval === "never") {
    throw new AppError("APPROVAL_NOT_APPLICABLE", `"${spec.label}" does not use two-person approval.`, 400);
  }
  return spec;
}

export interface ApprovalRequestInput {
  actionKey: string;
  payload: Record<string, unknown>;
  reason: string;
  ticketRef?: string;
}

interface ResolvedTarget {
  targetType: string;
  targetId: string;
  targetTenantId?: string;
  targetLabel: string;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/**
 * What an approval is about, derived from the action and its exact input (never from client-supplied labels), so a
 * request can't describe one target while its payload names another (security review M3).
 */
export function resolveApprovalTarget(actionKey: string, payload: Record<string, unknown>): ResolvedTarget {
  const bad = (why: string) => new AppError("APPROVAL_PAYLOAD_INVALID", why, 400);
  if (actionKey.startsWith("tenant.")) {
    const id = str(payload.tenant);
    const tenant = id ? db.findTenantById(id) : undefined;
    if (!tenant) throw bad("The payload must name an existing tenant.");
    return { targetType: "tenant", targetId: tenant.id, targetTenantId: tenant.id, targetLabel: tenant.name };
  }
  if (actionKey.startsWith("kill_switch.")) {
    const id = str(payload.switch_id);
    if (!id) throw bad("The payload must name a switch_id.");
    const scope = str(payload.scope);
    const target = str(payload.target_id);
    const label = scope ? `${scope}${target ? ` ${target}` : ""} kill switch` : `${db.findPlatformKillSwitch(id)?.scope ?? id} kill switch`;
    return { targetType: "kill_switch", targetId: id, targetLabel: label };
  }
  if (actionKey === "operator.assign_role") {
    const userId = str(payload.user_id);
    const role = str(payload.role);
    const user = userId ? db.findUserById(userId) : undefined;
    if (!user || !role || !(role in PLATFORM_ROLE_PERMISSIONS)) throw bad("The payload must name an existing user_id and a platform role.");
    return { targetType: "operator", targetId: user.id, targetLabel: `${user.email} → ${role}` };
  }
  if (actionKey === "plan.migrate") {
    const from = str(payload.from_version_id) ? db.findPlanVersionById(payload.from_version_id as string) : undefined;
    const to = str(payload.to_version_id) ? db.findPlanVersionById(payload.to_version_id as string) : undefined;
    const tenants = Array.isArray(payload.tenants) ? payload.tenants.length : 0;
    if (!from || !to) throw bad("The payload must name existing from_version_id and to_version_id.");
    return { targetType: "plan_version", targetId: to.id, targetLabel: `${from.plan_id} v${from.version} → ${to.plan_id} v${to.version} (${tenants} tenants)` };
  }
  if (actionKey === "platform_config.update_governed") {
    const key = str(payload.key);
    if (!key) throw bad("The payload must name a setting key.");
    return { targetType: "platform", targetId: key, targetLabel: `${key} → ${JSON.stringify(payload.value)}` };
  }
  throw bad(`"${actionKey}" has no approval target mapping.`);
}

/** No demotion from above: the caller must also hold every permission of the target's current role. */
export function assertHoldsCurrentRole(holder: PlatformPermission[] | readonly string[], userId: unknown): void {
  const current = typeof userId === "string" ? db.findPlatformMembershipByUserId(userId) : undefined;
  if (!current) return; // a new operator has no current role
  const perms: readonly string[] = PLATFORM_ROLE_PERMISSIONS[current.role] ?? [];
  if (!perms.every((p) => holder.includes(p as PlatformPermission))) {
    throw new ForbiddenError("You can't change the role of an operator whose permissions you don't hold.");
  }
}

/** No privilege escalation through role changes: the caller must hold every permission of the role being granted. */
function assertHoldsRole(holder: PlatformPermission[] | readonly string[], role: unknown, who: string): void {
  const perms = typeof role === "string" ? (PLATFORM_ROLE_PERMISSIONS as Record<string, readonly string[]>)[role] : undefined;
  if (!perms) throw new AppError("APPROVAL_PAYLOAD_INVALID", "Unknown platform role.", 400);
  if (!perms.every((p) => holder.includes(p as PlatformPermission))) {
    throw new ForbiddenError(`${who} can't grant a role with permissions ${who === "You" ? "you don't" : "they don't"} hold.`);
  }
}

export class PlatformApprovalService {
  /** Creates a PENDING request (or returns the caller's identical pending one). The requester must be able to run the action. */
  public static request(context: PlatformContext, input: ApprovalRequestInput): PlatformApprovalRequestRecord {
    const spec = specOrThrow(input.actionKey);
    PlatformAuthorizationService.assertCan(context, spec.permission as PlatformPermission);
    const target = resolveApprovalTarget(spec.key, input.payload);
    if (spec.key === "operator.assign_role") {
      if (input.payload.user_id === context.platformUser.id) throw new ForbiddenError("You can't request a change to your own role.");
      assertHoldsRole(context.permissions, input.payload.role, "You");
      assertHoldsCurrentRole(context.permissions, input.payload.user_id);
    }

    const reason = input.reason?.trim() ?? "";
    if (reason.length < Math.max(spec.reasonMin, 10)) {
      throw new AppError("REASON_REQUIRED", "An approval request needs a reason of at least 10 characters.", 400);
    }
    if (spec.ticketRequired && !input.ticketRef?.trim()) {
      throw new AppError("TICKET_REQUIRED", `"${spec.label}" needs a ticket or incident reference.`, 400);
    }

    const now = Date.now();
    const hash = payloadHash(input.payload);
    const existing = db
      .getPlatformApprovalRequests()
      .find(
        (r) =>
          r.status === "PENDING" &&
          r.action_key === spec.key &&
          r.payload_hash === hash &&
          r.requested_by === context.platformUser.id &&
          Date.parse(r.expires_at) > now
      );
    if (existing) return existing;

    const minutes = PlatformSettingsService.getEffectiveSetting<number>("approvals.expiry_minutes");
    const record: PlatformApprovalRequestRecord = {
      id: `apr_${randomSuffix()}`,
      action_key: spec.key,
      target_type: target.targetType,
      target_id: target.targetId,
      ...(target.targetTenantId ? { target_tenant_id: target.targetTenantId } : {}),
      target_label: target.targetLabel,
      payload: input.payload,
      payload_hash: hash,
      reason,
      ...(input.ticketRef?.trim() ? { ticket_ref: input.ticketRef.trim() } : {}),
      requested_by: context.platformUser.id,
      requested_by_role: context.platformRole,
      requested_at: new Date(now).toISOString(),
      expires_at: new Date(now + minutes * 60_000).toISOString(),
      status: "PENDING",
    };
    db.savePlatformApprovalRequest(record);

    PlatformAuditService.record(
      {
        action: "approval.requested",
        resource_type: "platform_approval_request",
        resource_id: record.id,
        target_tenant_id: record.target_tenant_id,
        reason,
        after_state: { action_key: spec.key, target_id: record.target_id, payload_hash: hash, expires_at: record.expires_at },
        result: "SUCCESS",
      },
      context
    );
    return record;
  }

  public static list(
    context: PlatformContext,
    filters: { status?: ApprovalEffectiveStatus; limit?: number } = {},
    now: number = Date.now()
  ): ApprovalView[] {
    PlatformAuthorizationService.assertCan(context, "platform.read");
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    return db
      .getPlatformApprovalRequests()
      .map((r) => this.view(context, r, now))
      .filter((v) => !filters.status || v.effective_status === filters.status)
      .slice(0, limit);
  }

  public static get(context: PlatformContext, id: string, now: number = Date.now()): ApprovalView {
    PlatformAuthorizationService.assertCan(context, "platform.read");
    const record = db.findPlatformApprovalRequest(id);
    if (!record) throw new NotFoundError("Approval request not found.");
    return this.view(context, record, now);
  }

  private static view(context: PlatformContext, r: PlatformApprovalRequestRecord, now: number): ApprovalView {
    const spec = findPrivilegedAction(r.action_key);
    const status = effectiveStatus(r, now);
    const isRequester = r.requested_by === context.platformUser.id;
    const holds = (p: string) => PlatformAuthorizationService.can(context, p as PlatformPermission);
    return {
      ...r,
      effective_status: status,
      action_label: spec?.label ?? r.action_key,
      risk: spec?.risk ?? "CRITICAL",
      can_decide: status === "PENDING" && !isRequester && holds("approval.decide") && Boolean(spec && holds(spec.permission)),
      can_execute: status === "APPROVED" && isRequester,
    };
  }

  /** Approves or rejects (step-up). The approver is never the requester and must also hold the action's permission. */
  public static decide(
    context: PlatformContext,
    id: string,
    decision: "APPROVE" | "REJECT",
    note: string | undefined
  ): PlatformApprovalRequestRecord {
    PlatformAuthorizationService.assertCan(context, "approval.decide" as PlatformPermission);
    PlatformAuthorizationService.assertStepUp(context, "approval.decide");

    const record = db.findPlatformApprovalRequest(id);
    if (!record) throw new NotFoundError("Approval request not found.");
    const spec = specOrThrow(record.action_key);
    PlatformAuthorizationService.assertCan(context, spec.permission as PlatformPermission);

    const status = effectiveStatus(record, Date.now());
    if (status !== "PENDING") {
      throw new AppError("APPROVAL_NOT_PENDING", `This request is ${status.toLowerCase()} and can't be decided.`, 409);
    }
    if (record.requested_by === context.platformUser.id) {
      this.recordRefusal(context, record, "Requester tried to decide their own request");
      throw new ForbiddenError("You can't approve or reject your own request; a second operator must decide it.");
    }
    if (spec.key === "operator.assign_role" && decision === "APPROVE") {
      if (record.payload.user_id === context.platformUser.id) {
        this.recordRefusal(context, record, "The operator whose role changes tried to approve it");
        throw new ForbiddenError("You can't approve a change to your own role.");
      }
      assertHoldsRole(context.permissions, record.payload.role, "You");
      assertHoldsCurrentRole(context.permissions, record.payload.user_id);
    }
    if (decision === "REJECT" && (!note || note.trim().length < 10)) {
      throw new AppError("REASON_REQUIRED", "Rejecting a request needs a note of at least 10 characters.", 400);
    }

    const updated: PlatformApprovalRequestRecord = {
      ...record,
      status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
      decided_by: context.platformUser.id,
      decided_at: new Date().toISOString(),
      ...(note?.trim() ? { decision_note: note.trim() } : {}),
    };
    db.savePlatformApprovalRequest(updated);

    PlatformAuditService.record(
      {
        action: decision === "APPROVE" ? "approval.approved" : "approval.rejected",
        resource_type: "platform_approval_request",
        resource_id: record.id,
        target_tenant_id: record.target_tenant_id,
        reason: note?.trim() || `${spec.label} ${decision === "APPROVE" ? "approved" : "rejected"}`,
        before_state: { status: record.status },
        after_state: { status: updated.status, requested_by: record.requested_by },
        result: "SUCCESS",
      },
      context
    );
    return updated;
  }

  /** The requester (or an approver) withdraws a request that has not run. */
  public static cancel(context: PlatformContext, id: string): PlatformApprovalRequestRecord {
    PlatformAuthorizationService.assertCan(context, "platform.read");
    const record = db.findPlatformApprovalRequest(id);
    if (!record) throw new NotFoundError("Approval request not found.");
    const isRequester = record.requested_by === context.platformUser.id;
    if (!isRequester && !PlatformAuthorizationService.can(context, "approval.decide" as PlatformPermission)) {
      throw new ForbiddenError("Only the requester or an approver can cancel this request.");
    }
    if (record.status !== "PENDING" && record.status !== "APPROVED") {
      throw new AppError("APPROVAL_NOT_CANCELLABLE", `This request is ${record.status.toLowerCase()}.`, 409);
    }
    const updated: PlatformApprovalRequestRecord = {
      ...record,
      status: "CANCELLED",
      decided_by: record.decided_by ?? context.platformUser.id,
      decided_at: record.decided_at ?? new Date().toISOString(),
    };
    db.savePlatformApprovalRequest(updated);
    PlatformAuditService.record(
      {
        action: "approval.cancelled",
        resource_type: "platform_approval_request",
        resource_id: record.id,
        target_tenant_id: record.target_tenant_id,
        reason: "Approval request cancelled",
        before_state: { status: record.status },
        after_state: { status: "CANCELLED" },
        result: "SUCCESS",
      },
      context
    );
    return updated;
  }

  /**
   * Marks an APPROVED request as used by this execution. It must be the requester, the same action, the same
   * canonical input, unexpired and unused. Called inside the action's unit of work: if the action then fails, the
   * store change is rolled back and the approval stays usable.
   */
  public static consumeForExecution(
    context: PlatformContext,
    approvalId: string,
    actionKey: string,
    payload: Record<string, unknown>
  ): PlatformApprovalRequestRecord {
    const record = db.findPlatformApprovalRequest(approvalId);
    if (!record) throw new AppError("APPROVAL_INVALID", "The approval request was not found.", 403);
    const problem =
      record.action_key !== actionKey
        ? "The approval is for a different action."
        : record.requested_by !== context.platformUser.id
          ? "Only the operator who requested the approval can run it."
          : effectiveStatus(record, Date.now()) !== "APPROVED"
            ? `The approval is ${effectiveStatus(record, Date.now()).toLowerCase()}, not approved.`
            : record.payload_hash !== payloadHash(payload)
              ? "The action input differs from what was approved."
              : !approverStillEntitled(record)
                ? "The operator who approved this can no longer approve it."
                : null;
    if (problem) {
      this.recordRefusal(context, record, problem);
      throw new AppError("APPROVAL_INVALID", problem, 403, { approval_id: approvalId });
    }

    const updated: PlatformApprovalRequestRecord = {
      ...record,
      status: "EXECUTED",
      executed_at: new Date().toISOString(),
      executed_request_id: context.requestId,
    };
    db.savePlatformApprovalRequest(updated);
    return updated;
  }

  /** A refused decision or execution is audited even though the request fails (kept past the rollback). */
  private static recordRefusal(context: PlatformContext, record: PlatformApprovalRequestRecord, why: string): void {
    const entry = PlatformAuditService.record(
      {
        action: "approval.refused",
        resource_type: "platform_approval_request",
        resource_id: record.id,
        target_tenant_id: record.target_tenant_id,
        reason: why,
        result: "BLOCKED",
        error_message: why,
      },
      context
    );
    if (entry?.id) db.keepEvenIfRequestFails("platform_audit_logs", entry.id);
  }
}
