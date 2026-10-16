import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformCommunicationsService } from "@/domains/platform/services/platform-communications.service";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

export const dynamic = "force-dynamic";

/** Maintenance windows with their status derived from the clock; `?active=true` keeps only those in progress. */
async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const activeOnly = new URL(request.url).searchParams.get("active") === "true";
    const windows = PlatformCommunicationsService.listMaintenance(context);
    return apiSuccess(activeOnly ? windows.filter((w) => w.is_active) : windows);
  } catch (error) {
    return apiError(error);
  }
}

const Reason = z.string().trim().min(10).max(1000);

const Body = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("SCHEDULE"),
      title: z.string().trim().min(3).max(150),
      description: z.string().trim().min(3).max(2000),
      scheduled_start: z.string().datetime(),
      scheduled_end: z.string().datetime(),
      reason: Reason,
    })
    .strict(),
  z.object({ action: z.literal("CANCEL"), id: z.string().min(1).max(100), reason: Reason }).strict(),
]);

/** Schedules or cancels an informational maintenance window (MEDIUM). */
async function handlePOST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = parseOrThrow(Body, await readJson(request));
    if (body.action === "CANCEL") return apiSuccess(PlatformCommunicationsService.cancelMaintenance(context, body.id, body.reason));
    return apiSuccess(
      PlatformCommunicationsService.scheduleMaintenance(context, {
        title: body.title,
        description: body.description,
        scheduled_start: body.scheduled_start,
        scheduled_end: body.scheduled_end,
        reason: body.reason,
      }),
      undefined,
      201
    );
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
