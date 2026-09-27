import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";
import { workflowEngine } from "@/domains/ai/orchestration/engine/workflow-engine";
import { AppError } from "@/lib/errors";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_READ);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;

    const workflows = db.getWorkflows(context.tenant.id, status);
    return apiSuccess(workflows, { total: workflows.length });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_RUN);

    const body = await request.json();
    if (!body.name || !body.objective) {
      throw new AppError("VALIDATION_ERROR", "Workflow name and objective are required", 400);
    }

    const workflow = await workflowEngine.createWorkflow({
      tenantId: context.tenant.id,
      name: body.name,
      description: body.description,
      objective: body.objective,
      triggerType: body.trigger_type,
      createdBy: context.user.id,
      createdByType: "USER",
      contextEntities: body.context_entities,
      budget: body.budget,
    });

    if (body.auto_start) {
      // Start workflow asynchronously
      workflowEngine.startWorkflow(workflow.tenant_id, workflow.id).catch((err) => {
        console.error(`Auto-start workflow failed: ${err}`);
      });
    }

    return apiSuccess(workflow, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
