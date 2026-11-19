import { identifyWorkspaceWebhookCall } from "@/domains/notifications/alerts-bot";
import { handleAlertsWebhookRequest } from "@/domains/notifications/alerts-webhook";
import { withStore } from "@/lib/store-unit";

/**
 * Telegram's calls for one workspace's own alerts bot (ADR-128). The address key and the secret are random and stored
 * by the server; a call is accepted only with that bot's secret, and acts only on that workspace.
 */
async function handlePOST(request: Request, { params }: { params: Promise<{ botKey: string }> }) {
  const { botKey } = await params;
  return handleAlertsWebhookRequest(request, (header) => identifyWorkspaceWebhookCall(botKey, header));
}

export const POST = withStore("POST", handlePOST);
