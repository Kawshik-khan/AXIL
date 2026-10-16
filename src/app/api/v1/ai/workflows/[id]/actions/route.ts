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
  action: z.enum(["START", "PAUSE", "RESUME", "CANCEL", "RETRY"]),
  reason: z.string().trim().max(1000).optional(),
}).strict();

async function handlePOST(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_RUN);

    const workflow = db.getWorkflowById(context.tenant.id, params.id);
    if (!workflow || workflow.tenant_id !== context.tenant.id) {
      throw new NotFoundError(`Workflow '${params.id}' not found`);
    }

    const body = parseOrThrow(Body, await readJson(request));
    const action = body.action;
    const reason = body.reason || `Operator action: ${action}`;

    let updatedWorkflow;
    switch (action) {
      case "PAUSE":
        updatedWorkflow = await workflowEngine.pauseWorkflow(workflow.tenant_id, workflow.id, reason);
        break;
      case "CANCEL":
        updatedWorkflow = await workflowEngine.cancelWorkflow(workflow.tenant_id, workflow.id, reason);
        break;
      default:
        break;
    }

    if (action === "START" || action === "RESUME" || action === "RETRY") {
      const key = request.headers.get("idempotency-key") || `${context.requestId}:${action}`;
      const job = await workflowEngine.enqueueAction(workflow.tenant_id, workflow.id, action, key);
      return apiSuccess({ workflow, action, execution_job: job }, undefined, 202);
    }

    return apiSuccess({ workflow: updatedWorkflow, action });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
