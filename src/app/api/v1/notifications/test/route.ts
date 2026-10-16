import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { NotificationService } from "@/domains/notifications/notification.service";
import { AppError } from "@/lib/errors";
import { withStore } from "@/lib/store-unit";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";

/** Sends a test message to the connected chat. Answers 502 when Telegram didn't take it (never a false "sent"). */
async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    await enforceRateLimit(`notifications:test:${context.tenant.id}`, 5, MINUTE); // the bot's send quota is shared by every shop
    const result = await NotificationService.sendTest(context);
    if (result.status !== "SENT") {
      throw new AppError(result.status === "NOT_SENT" ? "NOT_SENT" : "SEND_FAILED", result.reason ?? "Nothing was sent.", result.status === "NOT_SENT" ? 503 : 502);
    }
    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
