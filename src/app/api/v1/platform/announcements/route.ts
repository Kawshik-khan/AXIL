import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformCommunicationsService } from "@/domains/platform/services/platform-communications.service";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

export const dynamic = "force-dynamic";

async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    return apiSuccess(PlatformCommunicationsService.listAnnouncements(context));
  } catch (error) {
    return apiError(error);
  }
}

const Body = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("SAVE"),
      id: z.string().min(1).max(100).optional(),
      title: z.string().trim().min(3).max(150),
      message: z.string().trim().min(3).max(2000),
      announcement_type: z.enum(["INFO", "WARNING", "MAINTENANCE", "INCIDENT", "FEATURE"]),
      target_scope: z.enum(["ALL_TENANTS", "PLAN", "TENANT_LIST"]),
      plan_ids: z.array(z.string().min(1).max(40)).max(50).optional(),
      target_tenant_ids: z.array(z.string().min(1).max(100)).max(1000).optional(),
      expires_at: z.string().datetime().optional(),
    })
    .strict(),
  z.object({ action: z.literal("PUBLISH"), id: z.string().min(1).max(100) }).strict(),
  z.object({ action: z.literal("UNPUBLISH"), id: z.string().min(1).max(100) }).strict(),
]);

/** Saves a draft, publishes it to the targeted merchant workspaces, or unpublishes it (MEDIUM). */
async function handlePOST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = parseOrThrow(Body, await readJson(request));
    if (body.action === "PUBLISH") return apiSuccess(PlatformCommunicationsService.setPublished(context, body.id, true));
    if (body.action === "UNPUBLISH") return apiSuccess(PlatformCommunicationsService.setPublished(context, body.id, false));
    return apiSuccess(
      PlatformCommunicationsService.saveAnnouncement(context, {
        id: body.id,
        title: body.title,
        message: body.message,
        announcement_type: body.announcement_type,
        target_scope: body.target_scope,
        plan_ids: body.plan_ids,
        target_tenant_ids: body.target_tenant_ids,
        expires_at: body.expires_at,
      })
    );
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
