import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformAddonService } from "@/domains/platform/services/platform-addon.service";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

type Params = { params: Promise<{ id: string }> };

/** Add-ons granted to the tenant in the path, with whether each is active now. */
async function handleGET(request: Request, { params }: Params) {
  try {
    const context = await extractPlatformContext(request);
    const { id } = await params;
    return apiSuccess(PlatformAddonService.listForTenant(context, id));
  } catch (error) {
    return apiError(error);
  }
}

const Reason = z.string().trim().min(10).max(1000);

const Body = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("GRANT"),
      addon_id: z.string().min(1).max(100),
      quantity: z.number().int().min(1).max(10_000),
      starts_at: z.string().datetime().optional(),
      ends_at: z.string().datetime().optional(),
      reason: Reason,
      ticket_ref: z.string().trim().min(1).max(100).optional(),
    })
    .strict(),
  z.object({ action: z.literal("REVOKE"), grant_id: z.string().min(1).max(100), reason: Reason }).strict(),
]);

/** Grants (COMPLIMENTARY) or revokes an add-on for the tenant in the path (MEDIUM). */
async function handlePOST(request: Request, { params }: Params) {
  try {
    const context = await extractPlatformContext(request);
    const { id } = await params;
    const body = parseOrThrow(Body, await readJson(request));
    if (body.action === "REVOKE") return apiSuccess(PlatformAddonService.revoke(context, id, body.grant_id, body.reason));
    const { action: _action, ...input } = body;
    return apiSuccess(PlatformAddonService.grant(context, id, input), undefined, 201);
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
