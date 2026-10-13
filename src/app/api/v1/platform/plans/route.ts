import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformPlanService } from "@/domains/platform/services/platform-plan.service";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

/** Plans with every version, subscriber counts and MRR. */
async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    return apiSuccess(PlatformPlanService.listPlans(context));
  } catch (error) {
    return apiError(error);
  }
}

const Body = z
  .object({
    id: z.string().trim().min(2).max(40),
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).default(""),
    visibility: z.enum(["PUBLIC", "HIDDEN", "PRIVATE"]).default("HIDDEN"),
    display_order: z.number().int().min(0).max(1000).optional(),
    highlight_label: z.string().trim().max(40).optional(),
    reason: z.string().trim().min(10).max(1000),
  })
  .strict();

/** Creates a plan with an empty draft v1 (MEDIUM). Nothing is sellable until a version is published. */
async function handlePOST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = parseOrThrow(Body, await readJson(request));
    return apiSuccess(PlatformPlanService.createPlan(context, body), undefined, 201);
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
