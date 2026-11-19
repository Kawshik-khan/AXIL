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
        chat_escalated: z.boolean(),
        new_order_high_value: z.boolean(),
        payment_failed: z.boolean(),
      })
      .partial()
      .strict()
      .optional(),
    bot_token: z.string().trim().max(200).nullable().optional(),
    assistant: z
      .object({
        questions_enabled: z.boolean(),
        group_questions: z.boolean(),
        high_value_order_bdt: z.number().int().min(100).max(10_000_000),
        quiet_hours: z.object({ start_hour: z.number().int().min(0).max(23), end_hour: z.number().int().min(0).max(23) }).strict(),
      })
      .partial()
      .strict()
      .optional(),
  })
  .strict()
  .refine((b) => b.alerts !== undefined || b.bot_token !== undefined || b.assistant !== undefined, {
    message: "Provide alerts, assistant or bot_token.",
  });

/** Switches alerts on or off, or sets/clears the workspace Telegram alerts bot token. */
async function handlePATCH(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = parseOrThrow(AlertsPatch, await readJson(request));
    const bot = body.bot_token !== undefined ? await NotificationService.configureBot(context, body.bot_token) : undefined;
    const alerts = body.alerts !== undefined ? NotificationService.updateAlerts(context, body.alerts) : undefined;
    const assistant = body.assistant !== undefined ? NotificationService.updateAssistant(context, body.assistant) : undefined;
    return apiSuccess({
      ...(alerts !== undefined ? { alerts } : {}),
      ...(assistant !== undefined ? { assistant } : {}),
      ...(bot !== undefined ? { bot } : {}),
    });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const PATCH = withStore("PATCH", handlePATCH);
