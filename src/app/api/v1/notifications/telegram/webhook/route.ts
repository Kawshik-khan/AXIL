import { identifyAlertsWebhookCall } from "@/domains/notifications/alerts-bot";
import { handleAlertsWebhookRequest } from "@/domains/notifications/alerts-webhook";
import { withStore } from "@/lib/store-unit";

/**
 * Telegram's calls for the CommerceOS platform alerts bot (and, until they are registered again, workspace bots saved
 * before random webhook secrets, for their own workspace only). Workspace bots now call `…/webhook/<key>` (ADR-128).
 */
async function handlePOST(request: Request) {
  return handleAlertsWebhookRequest(request, (header) => identifyAlertsWebhookCall(header));
}

export const POST = withStore("POST", handlePOST);
