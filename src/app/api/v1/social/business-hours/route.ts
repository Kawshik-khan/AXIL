import { z } from "zod";
import { parseOrThrow, readJson } from "@/lib/validation";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { QuickReplyService } from "@/domains/social/templates/quick-reply.service";
import { withStore } from "@/lib/store-unit";

const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
// FX-12: without a schema the whole body (including tenant_id) was merged into the stored record.
const BusinessHoursPatch = z
  .object({
    timezone: z.string().min(1).max(64),
    schedule: z
      .array(
        z
          .object({
            day: z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]),
            is_open: z.boolean(),
            open_time: TIME,
            close_time: TIME,
          })
          .strict()
      )
      .max(7),
    auto_reply_enabled: z.boolean(),
    offline_message: z.string().max(1000),
  })
  .partial()
  .strict();

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const businessHours = await QuickReplyService.getBusinessHours(context);
    return apiSuccess({ businessHours });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePUT(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = parseOrThrow(BusinessHoursPatch, await readJson(request));

    const updated = await QuickReplyService.updateBusinessHours(context, body);
    return apiSuccess({ businessHours: updated });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const PUT = withStore("PUT", handlePUT);
