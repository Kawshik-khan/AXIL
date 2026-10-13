import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformAddonService } from "@/domains/platform/services/platform-addon.service";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    return apiSuccess(PlatformAddonService.list(context));
  } catch (error) {
    return apiError(error);
  }
}

const Reason = z.string().trim().min(10).max(1000);

const Body = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("CREATE"),
      name: z.string().trim().min(2).max(80),
      description: z.string().trim().max(500).default(""),
      entitlement_id: z.string().min(1).max(100),
      increment: z.number().int().min(1).max(10_000_000),
      allowed_plan_ids: z.array(z.string().min(1).max(40)).max(50).default([]),
      reason: Reason,
    })
    .strict(),
  z.object({ action: z.literal("RETIRE"), addon_id: z.string().min(1).max(100), reason: Reason }).strict(),
]);

/** Creates (MEDIUM) or retires (MEDIUM) an add-on definition. */
async function handlePOST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = parseOrThrow(Body, await readJson(request));
    if (body.action === "RETIRE") return apiSuccess(PlatformAddonService.retire(context, body.addon_id, body.reason));
    const { action: _action, ...input } = body;
    return apiSuccess(PlatformAddonService.create(context, input), undefined, 201);
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
