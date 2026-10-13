import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformPlanService } from "@/domains/platform/services/platform-plan.service";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

type Params = { params: Promise<{ id: string }> };

async function handleGET(request: Request, { params }: Params) {
  try {
    const context = await extractPlatformContext(request);
    const { id } = await params;
    return apiSuccess(PlatformPlanService.getPlan(context, id));
  } catch (error) {
    return apiError(error);
  }
}

const Body = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(500).optional(),
    visibility: z.enum(["PUBLIC", "HIDDEN", "PRIVATE"]).optional(),
    private_tenant_ids: z.array(z.string().min(1).max(100)).max(500).optional(),
    display_order: z.number().int().min(0).max(1000).nullable().optional(),
    highlight_label: z.string().trim().max(40).nullable().optional(),
    is_active: z.boolean().optional(),
    reason: z.string().trim().min(10).max(1000),
  })
  .strict();

/** Edits plan identity and visibility (MEDIUM). Prices and limits live on versions. */
async function handlePATCH(request: Request, { params }: Params) {
  try {
    const context = await extractPlatformContext(request);
    const { id } = await params;
    const body = parseOrThrow(Body, await readJson(request));
    return apiSuccess(PlatformPlanService.updatePlan(context, id, body));
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
export const PATCH = withStore("PATCH", handlePATCH);
