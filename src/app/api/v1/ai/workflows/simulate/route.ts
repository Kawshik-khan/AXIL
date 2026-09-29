import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { workflowSimulator } from "@/domains/ai/orchestration/simulation/workflow-simulator";
import { BadRequestError } from "@/lib/errors";
import { withStore } from "@/lib/store-unit";

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_READ);

    const body = await request.json();
    if (!body.objective) {
      throw new BadRequestError("Objective is required for workflow simulation");
    }

    const simulation = await workflowSimulator.simulate(
      context.tenant.id,
      body.objective,
      body.context
    );

    return apiSuccess(simulation);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
