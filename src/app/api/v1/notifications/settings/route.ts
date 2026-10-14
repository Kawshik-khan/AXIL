import { z } from "zod";
import { parseOrThrow, readJson } from "@/lib/validation";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { NotificationService } from "@/domains/notifications/notification.service";
import { withStore } from "@/lib/store-unit";

/** Read-only: which alerts are on, and whether a Telegram chat is connected. */
async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    return apiSuccess(await NotificationService.getSettings(context));
  } catch (err) {
    return apiError(err);
  }
}

const AlertsPatch = z
  .object({
    alerts: z
      .object({
        daily_summary: z.boolean(),
        low_stock: z.boolean(),
        failed_deliveries: z.boolean(),
        cod_weekly: z.boolean(),
      })
      .partial()
      .strict(),
  })
  .strict();

/** Switches alerts on or off. */
async function handlePATCH(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = parseOrThrow(AlertsPatch, await readJson(request));
    return apiSuccess({ alerts: NotificationService.updateAlerts(context, body.alerts) });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const PATCH = withStore("PATCH", handlePATCH);
