import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { NotificationService } from "@/domains/notifications/notification.service";
import { withStore } from "@/lib/store-unit";

/** Stops alerts going to the connected Telegram chat. */
async function handleDELETE(request: Request) {
  try {
    const context = await extractRequestContext(request);
    await NotificationService.disconnectTelegram(context);
    return apiSuccess({ connected: false });
  } catch (err) {
    return apiError(err);
  }
}

export const DELETE = withStore("DELETE", handleDELETE);
