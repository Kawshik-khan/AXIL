import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";
import { NotFoundError } from "@/lib/errors";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_READ);

    const workflow = db.getWorkflowById(context.tenant.id, params.id);
    if (!workflow || workflow.tenant_id !== context.tenant.id) {
      throw new NotFoundError(`Workflow '${params.id}' not found`);
    }

    const tasks = db.getTasks(context.tenant.id, workflow.id);
    const workflowContext = db.getWorkflowContext(context.tenant.id, workflow.id);
    const artifacts = db.getWorkflowArtifacts(context.tenant.id, workflow.id);
    const checkpoints = db.getWorkflowCheckpoints(context.tenant.id, workflow.id);
    const messages = db.getAgentMessages(context.tenant.id, workflow.id);

    return apiSuccess({
      ...workflow,
      tasks,
      workflow_context: workflowContext,
      artifacts,
      checkpoints,
      messages,
    });
  } catch (err) {
    return apiError(err);
  }
}
