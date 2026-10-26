/**
 * Webhook canary (messaging reliability MR3, FX-102): proves the inbound path end to end on the deployed app. Every run
 * posts a signed synthetic Telegram update to this app's own public webhook URL for a dedicated canary connector, and
 * reports the outcome of the turn the previous run's update started.
 *
 * Off until WEBHOOK_CANARY_CONNECTOR_ID names a Telegram connector. Its workspace must not be in autonomous mode: the
 * canary chat is synthetic, and nothing may be sent for it (shadow mode drafts a reply, which is what we want to see).
 */
import { db } from "@/infrastructure/db";
import { decryptCredential } from "@/lib/security";
import { appBaseUrl } from "@/lib/app-url";
import { outboundRequest } from "@/lib/outbound-http";
import { logger } from "@/lib/logger";
import { agentMode } from "@/domains/ai/customer-agent/jobs";
import { TELEGRAM_SECRET_HEADER } from "@/domains/social/channels/adapters/telegram.adapter";

/** The synthetic chat's id in the canary workspace (only ever stored there). */
export const CANARY_CHAT_ID = 1_000_000_001;

export interface CanaryReport {
  status: "NOT_CONFIGURED" | "OK" | "FAILED";
  code?: string;
  http_status?: number;
  previous_turn?: { status: string; outcome?: string } | null;
}

export async function runWebhookCanary(now = Date.now(), env: NodeJS.ProcessEnv = process.env): Promise<CanaryReport> {
  const connectorId = (env.WEBHOOK_CANARY_CONNECTOR_ID ?? "").trim();
  if (!connectorId) return { status: "NOT_CONFIGURED" };
  const fail = (code: string, extra: Partial<CanaryReport> = {}): CanaryReport => {
    logger.error("connector_webhook.canary_failed", { connector_id: connectorId, code, ...extra });
    return { status: "FAILED", code, ...extra };
  };

  const connector = db.findConnectorForIngress(connectorId);
  if (!connector || connector.provider_id !== "telegram") return fail("CANARY_CONNECTOR_MISSING");
  if (agentMode(connector.tenant_id) === "AUTONOMOUS") return fail("CANARY_WORKSPACE_AUTONOMOUS");
  const channel = db.getConnectedChannels(connector.tenant_id).find((c) => c.connector_id === connector.id);
  if (!channel) return fail("CANARY_NO_CHANNEL");
  const secret = decryptCredential<Record<string, unknown>>(connector.credentials_encrypted).webhook_secret;
  if (typeof secret !== "string" || !secret) return fail("CANARY_NO_SECRET");
  const base = appBaseUrl();
  if (!base || !base.startsWith("https://")) return fail("APP_URL_NOT_HTTPS");

  // What the previous run's update led to (the turn runs after this request, so it is read on the next run)
  const chat = db.findConversationByExternalId(connector.tenant_id, channel.id, String(CANARY_CHAT_ID));
  const job = chat ? db.findAgentJob(connector.tenant_id, chat.id) : undefined;
  const previous_turn = job ? { status: job.status, outcome: job.outcome } : null;

  const update = {
    update_id: Math.floor(now / 1000),
    message: {
      message_id: Math.floor(now / 1000),
      date: Math.floor(now / 1000),
      text: "canary: is the inbound path alive?",
      chat: { id: CANARY_CHAT_ID, type: "private" },
      from: { id: CANARY_CHAT_ID, first_name: "Canary" },
    },
  };
  let res;
  try {
    res = await outboundRequest(`${base}/api/v1/connectors/${connector.id}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [TELEGRAM_SECRET_HEADER]: secret },
      body: JSON.stringify(update),
      timeoutMs: 20_000,
      maxResponseBytes: 16 * 1024,
    });
  } catch {
    return fail("CANARY_UNREACHABLE", { previous_turn });
  }
  let accepted = false;
  try {
    accepted = (JSON.parse(res.body) as { status?: string }).status === "EVENT_RECEIVED";
  } catch {
    accepted = false;
  }
  if (res.status !== 200 || !accepted) return fail("CANARY_REJECTED", { http_status: res.status, previous_turn });
  return { status: "OK", http_status: res.status, previous_turn };
}
