import { randomUUID } from "crypto";
import { NotFoundError, AppError } from "@/lib/errors";
import { ApprovalRequest, ApprovalStatus, TaskStatus, WorkflowStatus } from "@/types/orchestration";
import { db } from "@/infrastructure/db";
import { workflowEngine } from "../engine/workflow-engine";
import { autonomyPolicyService } from "./autonomy-policy.service";
import { approvalBindingMismatch } from "./approval-binding";
import { loadOrderRows } from "@/infrastructure/db/tenant-rows";

export interface ApprovalResolutionResult {
  success: boolean;
  approval: ApprovalRequest;
  stale?: boolean;
  reason?: string;
}

export class ApprovalEngine {
  /** Atomically approves one pending request only if the exact task, policy and target state still match. */
  public async approveAction(tenantId: string, approvalId: string, approvedBy: string): Promise<ApprovalResolutionResult> {
    // Zero-hydration: the order the approval is bound to, for the target-state check
    const pending = db.getApprovalRequestById(tenantId, approvalId);
    if (pending?.target_entity_type === "ORDER" && pending.target_entity_id) await loadOrderRows(tenantId, [pending.target_entity_id]);
    const outcome = await db.unit(async () => {
      const approval = db.getApprovalRequestById(tenantId, approvalId);
      if (!approval) throw new NotFoundError("Approval request", approvalId);
      if (approval.status !== ApprovalStatus.PENDING) {
        return { success: false, approval, reason: `Approval request is already in status: ${approval.status}` };
      }
      if (!approvedBy.trim()) throw new AppError("VALIDATION_ERROR", "Approver identity is required.", 400);
      if (approval.requester_id && approval.requester_id === approvedBy) {
        this.audit(tenantId, approvedBy, "AI_APPROVAL_SELF_APPROVAL_BLOCKED", approval, { outcome: "DENIED" });
        return { success: false, approval, reason: "The requester cannot approve their own action." };
      }
      const now = new Date();
      if (!Number.isFinite(Date.parse(approval.expires_at)) || now.getTime() >= Date.parse(approval.expires_at)) {
        const expired = db.updateApprovalRequest(tenantId, approvalId, { status: ApprovalStatus.EXPIRED });
        const task = db.getTaskById(tenantId, approval.task_id);
        if (task?.status === TaskStatus.WAITING_APPROVAL && task.approval_id === approval.id) {
          db.updateTask(tenantId, task.id, { status: TaskStatus.FAILED, failure_class: "PERMANENT", completed_at: now.toISOString(), error: "Approval expired." });
        }
        this.audit(tenantId, approvedBy, "AI_APPROVAL_EXPIRED", approval, { outcome: "EXPIRED" });
        return { success: false, approval: expired, reason: "Approval request has expired." };
      }

      const task = db.getTaskById(tenantId, approval.task_id);
      if (!task || task.workflow_id !== approval.workflow_id || task.status !== TaskStatus.WAITING_APPROVAL || task.approval_id !== approval.id) {
        this.audit(tenantId, approvedBy, "AI_APPROVAL_STALE_TASK", approval, { outcome: "DENIED" });
        return { success: false, approval, stale: true, reason: "The approval is no longer bound to a task waiting for this decision." };
      }
      const policy = autonomyPolicyService.getPolicy(tenantId, task.agent_type);
      if (policy.is_emergency_stopped || !policy.enabled) {
        this.audit(tenantId, approvedBy, "AI_APPROVAL_BLOCKED_BY_POLICY", approval, { outcome: "DENIED", policy_version: policy.version });
        return { success: false, approval, reason: "Agent execution is disabled by the current safety policy." };
      }
      const bindingError = approvalBindingMismatch(approval, task, policy.version);
      const requiredNow = autonomyPolicyService.requiresApproval(tenantId, task.agent_type, task.risk_level);
      const mismatchReason = bindingError || (!requiredNow ? "Current policy no longer requires this approval; create a fresh task authorization." : undefined);
      if (mismatchReason) {
        const rejected = db.updateApprovalRequest(tenantId, approvalId, {
          status: ApprovalStatus.REJECTED,
          rejected_by: "SYSTEM_VALIDATOR",
          rejected_at: now.toISOString(),
          rejection_reason: mismatchReason,
        });
        db.updateTask(tenantId, task.id, { status: TaskStatus.FAILED, failure_class: "POLICY_DENIED", error: `Approval invalidated: ${mismatchReason}` });
        this.audit(tenantId, approvedBy, "AI_APPROVAL_INVALIDATED", rejected, { outcome: "INVALIDATED", reason: mismatchReason, policy_version: policy.version });
        return { success: false, approval: rejected, stale: true, reason: mismatchReason };
      }

      const approved = db.updateApprovalRequest(tenantId, approvalId, {
        status: ApprovalStatus.APPROVED,
        approved_by: approvedBy,
        approved_at: now.toISOString(),
      });
      db.updateTask(tenantId, task.id, { status: TaskStatus.READY });
      this.audit(tenantId, approvedBy, "AI_APPROVAL_APPROVED", approved, { outcome: "APPROVED", policy_version: policy.version });
      return { success: true, approval: approved, workflowId: approval.workflow_id };
    }, () => true);

    if (outcome.success && outcome.workflowId) {
      const workflow = db.getWorkflowById(tenantId, outcome.workflowId);
      if (workflow?.status === WorkflowStatus.WAITING) {
        await workflowEngine.enqueueAction(tenantId, workflow.id, "RESUME", `approval:${approvalId}:resume`);
      }
    }
    return { success: outcome.success, approval: outcome.approval, stale: outcome.stale, reason: outcome.reason };
  }

  /** Rejects only a pending request; terminal decisions are immutable. */
  public async rejectAction(tenantId: string, approvalId: string, rejectedBy: string, reason: string): Promise<ApprovalResolutionResult> {
    return db.unit(async () => {
      const approval = db.getApprovalRequestById(tenantId, approvalId);
      if (!approval) throw new NotFoundError("Approval request", approvalId);
      if (approval.status !== ApprovalStatus.PENDING) {
        this.audit(tenantId, rejectedBy, "AI_APPROVAL_DUPLICATE_DECISION", approval, { outcome: "DENIED" });
        return { success: false, approval, reason: `Approval request is already in status: ${approval.status}` };
      }
      if (!rejectedBy.trim() || !reason.trim()) throw new AppError("VALIDATION_ERROR", "Rejector identity and reason are required.", 400);
      const task = db.getTaskById(tenantId, approval.task_id);
      if (!task || task.workflow_id !== approval.workflow_id || task.status !== TaskStatus.WAITING_APPROVAL || task.approval_id !== approval.id) {
        this.audit(tenantId, rejectedBy, "AI_APPROVAL_STALE_REJECTION", approval, { outcome: "DENIED" });
        return { success: false, approval, stale: true, reason: "The approval is no longer bound to a task waiting for this decision." };
      }
      const rejected = db.updateApprovalRequest(tenantId, approvalId, {
        status: ApprovalStatus.REJECTED,
        rejected_by: rejectedBy,
        rejected_at: new Date().toISOString(),
        rejection_reason: reason.trim(),
      });
      db.updateTask(tenantId, task.id, { status: TaskStatus.CANCELLED, completed_at: new Date().toISOString(), error: "Rejected by an authorized operator." });
      this.audit(tenantId, rejectedBy, "AI_APPROVAL_REJECTED", rejected, { outcome: "REJECTED", reason: reason.trim() });
      return { success: true, approval: rejected };
    }, () => true);
  }

  private audit(tenantId: string, actorId: string, action: string, approval: ApprovalRequest, metadata: Record<string, unknown>): void {
    db.createAuditLog({
      id: `aud_${randomUUID()}`,
      tenant_id: tenantId,
      actor_user_id: actorId,
      action,
      resource_type: "ai_approval",
      resource_id: approval.id,
      metadata: {
        workflow_id: approval.workflow_id,
        task_id: approval.task_id,
        requested_action: approval.action,
        payload_digest: approval.payload_digest,
        ...metadata,
      },
      created_at: new Date().toISOString(),
    });
  }
}

export const approvalEngine = new ApprovalEngine();
