import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { NotificationService } from "@/domains/notifications/notification.service";
import { withStore } from "@/lib/store-unit";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";

/** A one-time link to the CommerceOS alerts bot (valid 15 minutes); pressing Start on it connects that chat. */
async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    await enforceRateLimit(`notifications:link:${context.tenant.id}`, 10, MINUTE);
    return apiSuccess(await NotificationService.createTelegramLink(context), undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
