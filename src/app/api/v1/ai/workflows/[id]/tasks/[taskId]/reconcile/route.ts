import { randomUUID } from "crypto";
import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";
import { workflowEngine } from "@/domains/ai/orchestration/engine/workflow-engine";
import { NotFoundError } from "@/lib/errors";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

const Body = z.object({
  outcome: z.enum(["APPLIED", "NOT_APPLIED"]),
  evidence: z.string().trim().min(1).max(2000),
  confirmed_result: z.record(z.string(), z.unknown()).optional(),
}).strict();

async function handlePOST(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string; taskId: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_MANAGE);

    const workflow = db.getWorkflowById(context.tenant.id, params.id);
    if (!workflow || workflow.tenant_id !== context.tenant.id) {
      throw new NotFoundError(`Workflow '${params.id}' not found`);
    }

    const task = db.getTaskById(context.tenant.id, params.taskId);
    if (!task || task.tenant_id !== context.tenant.id || task.workflow_id !== workflow.id) {
      throw new NotFoundError(`Workflow task '${params.taskId}' not found`);
    }

    const input = parseOrThrow(Body, await readJson(request));
    const confirmedResult =
      input.confirmed_result ??
      (input.outcome === "APPLIED" ? { reconciled: true, evidence: input.evidence } : undefined);

    const reconciledWorkflow = await workflowEngine.reconcileTaskOutcome(
      context.tenant.id,
      task.id,
      input.outcome,
      context.user.id,
      input.evidence,
      confirmedResult
    );

    db.createAuditLog({
      id: `audit_${randomUUID().substring(0, 12)}`,
      tenant_id: context.tenant.id,
      actor_user_id: context.user.id,
      action: "WORKFLOW_TASK_RECONCILED",
      resource_type: "workflow_task",
      resource_id: task.id,
      metadata: {
        workflow_id: workflow.id,
        outcome: input.outcome,
        evidence: input.evidence,
      },
      created_at: new Date().toISOString(),
    });

    return apiSuccess({
      workflow: reconciledWorkflow,
      task: db.getTaskById(context.tenant.id, task.id),
    });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
