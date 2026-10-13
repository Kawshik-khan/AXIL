import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformSettingsService } from "@/domains/platform";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

/**
 * Registered platform settings with the value in force (settings-registry.ts); `?key=` returns that setting's
 * version history.
 */
async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const key = new URL(request.url).searchParams.get("key");
    if (key) return apiSuccess(PlatformSettingsService.getSettingVersions(key, context));
    return apiSuccess(PlatformSettingsService.listEffectiveSettings(context));
  } catch (error) {
    return apiError(error);
  }
}

const Body = z
  .object({
    key: z.string().trim().min(1).max(100),
    // The registry schema for the key validates the value itself
    value: z.union([z.number(), z.boolean(), z.string().max(2000)]),
    reason: z.string().trim().min(10).max(1000),
    ticket_ref: z.string().trim().min(1).max(100).optional(),
    approval_id: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

/** Changes a registered setting (unregistered and unread keys are refused); HIGH/CRITICAL ones need a second operator. */
async function handlePOST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = parseOrThrow(Body, await readJson(request));
    return apiSuccess(PlatformSettingsService.updateSetting(body.key, body.value, body.reason, context, { ticketRef: body.ticket_ref, approvalId: body.approval_id }));
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
