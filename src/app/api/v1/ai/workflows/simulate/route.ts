import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { workflowSimulator } from "@/domains/ai/orchestration/simulation/workflow-simulator";
import { withStore } from "@/lib/store-unit";
import { z } from "zod";
import { parseOrThrow, readJson } from "@/lib/validation";

const Body = z.object({
  objective: z.string().trim().min(1).max(2000),
  template_code: z.enum(["ABANDONED_CART_RECOVERY", "LOW_STOCK_RESTOCK", "DELIVERY_EXCEPTION_RESOLVE", "REFUND_REVIEW", "WHOLESALE_QUOTE"]).optional(),
  context: z.record(z.unknown()).optional(),
}).strict();

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_READ);

    const body = parseOrThrow(Body, await readJson(request));

    const simulation = await workflowSimulator.simulate(
      context.tenant.id,
      body.objective,
      body.context,
      body.template_code
    );

    return apiSuccess(simulation);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
