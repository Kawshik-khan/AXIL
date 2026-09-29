import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";
import { workflowEngine } from "@/domains/ai/orchestration/engine/workflow-engine";
import { NotFoundError, BadRequestError } from "@/lib/errors";
import { withStore } from "@/lib/store-unit";

async function handlePOST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_RUN);

    const workflow = db.getWorkflowById(context.tenant.id, params.id);
    if (!workflow || workflow.tenant_id !== context.tenant.id) {
      throw new NotFoundError(`Workflow '${params.id}' not found`);
    }

    const body = await request.json();
    const action = body.action?.toUpperCase();
    const reason = body.reason || `Operator action: ${action}`;

    let updatedWorkflow;
    switch (action) {
      case "START":
        updatedWorkflow = await workflowEngine.startWorkflow(workflow.tenant_id, workflow.id);
        break;
      case "PAUSE":
        updatedWorkflow = await workflowEngine.pauseWorkflow(workflow.tenant_id, workflow.id, reason);
        break;
      case "RESUME":
        updatedWorkflow = await workflowEngine.resumeWorkflow(workflow.tenant_id, workflow.id);
        break;
      case "CANCEL":
        updatedWorkflow = await workflowEngine.cancelWorkflow(workflow.tenant_id, workflow.id, reason);
        break;
      case "RETRY":
        updatedWorkflow = await workflowEngine.retryWorkflow(workflow.tenant_id, workflow.id);
        break;
      default:
        throw new BadRequestError(`Invalid workflow action: ${action}. Expected START, PAUSE, RESUME, CANCEL, or RETRY.`);
    }

    return apiSuccess({ workflow: updatedWorkflow, action });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
