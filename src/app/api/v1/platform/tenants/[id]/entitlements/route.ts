import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformEntitlementService } from "@/domains/platform";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

type Params = { params: Promise<{ id: string }> };

/** Every catalog entitlement for the tenant in the path: value in force, source, usage, override. */
async function handleGET(request: Request, { params }: Params) {
  try {
    const context = await extractPlatformContext(request);
    const { id } = await params;
    return apiSuccess(await PlatformEntitlementService.getTenantEntitlementReport(id, context));
  } catch (error) {
    return apiError(error);
  }
}

const Reason = z.string().trim().min(10, "Give a reason of at least 10 characters.").max(500);

const Body = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("SET_OVERRIDE"),
      entitlement_id: z.string().min(1).max(100),
      value: z.union([z.number(), z.boolean(), z.null()]),
      reason: Reason,
      expires_at: z.string().datetime().optional(),
      ticket_ref: z.string().trim().min(1).max(100).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("CLEAR_OVERRIDE"),
      entitlement_id: z.string().min(1).max(100),
      reason: Reason,
    })
    .strict(),
]);

/** Sets (HIGH, step-up) or clears (MEDIUM) an override for the tenant in the path. */
async function handlePOST(request: Request, { params }: Params) {
  try {
    const context = await extractPlatformContext(request);
    const { id } = await params;
    const body = parseOrThrow(Body, await readJson(request));
    if (body.action === "CLEAR_OVERRIDE") {
      return apiSuccess(PlatformEntitlementService.clearTenantOverride(id, body.entitlement_id, body.reason, context));
    }
    return apiSuccess(
      PlatformEntitlementService.setTenantOverride(id, body.entitlement_id, body.value, body.reason, context, {
        expiresAt: body.expires_at,
        ticketRef: body.ticket_ref,
      })
    );
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
