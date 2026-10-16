import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformPlanService } from "@/domains/platform/services/platform-plan.service";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

const Body = z
  .object({
    from_version_id: z.string().min(1).max(100),
    to_version_id: z.string().min(1).max(100),
    target_tenant_ids: z.array(z.string().min(1).max(100)).max(10_000).optional(),
    reason: z.string().trim().min(10).max(1000),
    ticket_ref: z.string().trim().min(1).max(100).optional(),
    approval_id: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

/** Moves tenants to another published version now (HIGH: step-up, ticket; two-person above the threshold). */
async function handlePOST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = parseOrThrow(Body, await readJson(request));
    return apiSuccess(PlatformPlanService.migrate(context, body));
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withStore("POST", handlePOST);
