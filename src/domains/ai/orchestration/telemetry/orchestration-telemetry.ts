import { db } from '@/infrastructure/db';
import { WorkflowStatus, TaskStatus, ApprovalStatus } from '@/types/orchestration';

export interface OrchestrationMetrics {
  total_workflows: number;
  active_workflows: number;
  completed_workflows: number;
  failed_workflows: number;
  waiting_approval_workflows: number;
  success_rate: number;
  pending_approvals: number;
  total_action_receipts: number;
  total_verifications: number;
  verifier_rejection_count: number;
  active_kill_switches: number;
  agent_distribution: Record<string, number>;
}

export class OrchestrationTelemetry {
  /**
   * Calculates comprehensive operational telemetry for a tenant
   */
  public getTenantMetrics(tenantId: string): OrchestrationMetrics {
    const workflows = db.getWorkflows(tenantId);
    const tasks = db.getTasks(tenantId);
    const approvals = db.getApprovalRequests(tenantId);
    const receipts = db.getActionReceipts(tenantId);
    const policies = db.getAutonomyPolicies(tenantId);

    const total = workflows.length;
    const completed = workflows.filter((w) => w.status === WorkflowStatus.COMPLETED).length;
    const failed = workflows.filter((w) => w.status === WorkflowStatus.FAILED).length;
    const active = workflows.filter(
      (w) => w.status === WorkflowStatus.RUNNING || w.status === WorkflowStatus.QUEUED
    ).length;
    const waiting = workflows.filter((w) => w.status === WorkflowStatus.WAITING).length;

    const successRate = total > 0 ? Number(((completed / (completed + failed || 1)) * 100).toFixed(1)) : 100;
    const pendingApprovals = approvals.filter((a) => a.status === ApprovalStatus.PENDING).length;

    const agentDistribution: Record<string, number> = {};
    for (const t of tasks) {
      agentDistribution[t.agent_type] = (agentDistribution[t.agent_type] || 0) + 1;
    }

    const verifications = db.getAgentVerificationsByTenant(tenantId);
    const totalVerifications = verifications.length;
    const failedVerifications = verifications.filter((v) => v.status === "FAILED").length;

    const activeKillSwitches = policies.filter((p) => p.is_emergency_stopped).length;

    return {
      total_workflows: total,
      active_workflows: active,
      completed_workflows: completed,
      failed_workflows: failed,
      waiting_approval_workflows: waiting,
      success_rate: successRate,
      pending_approvals: pendingApprovals,
      total_action_receipts: receipts.length,
      total_verifications: totalVerifications,
      verifier_rejection_count: failedVerifications,
      active_kill_switches: activeKillSwitches,
      agent_distribution: agentDistribution,
    };
  }
}

export const orchestrationTelemetry = new OrchestrationTelemetry();
