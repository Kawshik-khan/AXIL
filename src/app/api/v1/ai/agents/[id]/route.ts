import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";
import { AppError } from "@/lib/errors";
import { AgentDefinition } from "@/types/ai";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_READ);

    const agent = db.findAgentById(context.tenant.id, params.id);
    if (!agent) {
      throw new AppError("NOT_FOUND", `Agent ${params.id} not found`, 404);
    }

    return apiSuccess(agent);
  } catch (err) {
    return apiError(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_MANAGE);

    const existing = db.findAgentById(context.tenant.id, params.id);
    if (!existing) {
      throw new AppError("NOT_FOUND", `Agent ${params.id} not found`, 404);
    }

    const body = await request.json();
    const updated = db.updateAgent(context.tenant.id, params.id, body as Partial<AgentDefinition>);
    return apiSuccess(updated);
  } catch (err) {
    return apiError(err);
  }
}
