import crypto from "crypto";
import { logger } from "@/lib/logger";
import { outboundRequest } from "@/lib/outbound-http";
import { signOutbound } from "@/lib/outbound-signing";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { AppError, AuthenticationError } from "@/lib/errors";
import { ConnectedChannel } from "@/types/social";
import {
  N8N_RAW_PATH,
  N8N_SEND_PATH,
  RAW_SCHEMA,
  SEND_SCHEMA,
  RawSocialEnvelope,
  SendSocialEnvelope,
  SocialChannelType,
  SOCIAL_CHANNEL_TYPES,
} from "./envelope";

/**
 * The CommerceOS side of the n8n path for social channels (connector plan C3).
 *
 * On when N8N_HOST is set and SOCIAL_N8N_MODE isn't "off". Calls to n8n are authenticated the same way as the
 * automation calls (FX-55): an HMAC signature when COMMERCEOS_N8N_WEBHOOK_SECRET is set and/or the shared
 * X-CommerceOS-Token when COMMERCEOS_N8N_WEBHOOK_TOKEN is set. Calls back from n8n carry
 * X-CommerceOS-Callback-Token, checked against COMMERCEOS_N8N_CALLBACK_TOKEN (a different secret on purpose).
 */

export const CALLBACK_TOKEN_HEADER = "x-commerceos-callback-token";
const CALL_TIMEOUT_MS = 8_000;

export class SocialN8nUnavailableError extends AppError {
  constructor(reason: string) {
    super("N8N_UNAVAILABLE", `n8n could not take the message (${reason}). Nothing was sent.`, 503);
  }
}

export function isSocialChannel(type: string): type is SocialChannelType {
  return (SOCIAL_CHANNEL_TYPES as readonly string[]).includes(type);
}

export function socialN8nEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.N8N_HOST?.trim()) && env.SOCIAL_N8N_MODE !== "off";
}

/** The public base URL n8n posts back to (APP_URL). Null when it isn't configured. */
export function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.APP_URL?.trim().replace(/\/+$/, "");
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1" ? u.origin : null;
  } catch {
    return null;
  }
}

function requireBaseUrl(): string {
  const base = appBaseUrl();
  if (!base) throw new SocialN8nUnavailableError("APP_URL is not set to this app's https address");
  return base;
}

async function callN8n(path: string, envelope: RawSocialEnvelope | SendSocialEnvelope): Promise<void> {
  const host = process.env.N8N_HOST?.trim().replace(/\/+$/, "");
  if (!host) throw new SocialN8nUnavailableError("N8N_HOST is not set");
  const secret = process.env.COMMERCEOS_N8N_WEBHOOK_SECRET;
  const token = process.env.COMMERCEOS_N8N_WEBHOOK_TOKEN;
  if (!secret && !token && process.env.NODE_ENV === "production") {
    throw new SocialN8nUnavailableError("no n8n webhook secret or token is configured");
  }
  const body = JSON.stringify(envelope);
  try {
    const res = await outboundRequest(`${host}/webhook/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? signOutbound(secret, body) : {}),
        ...(token ? { "X-CommerceOS-Token": token } : {}),
      },
      body,
      timeoutMs: CALL_TIMEOUT_MS,
      platformConfigured: true,
    });
    if (res.status < 200 || res.status >= 300) throw new SocialN8nUnavailableError(`n8n answered HTTP ${res.status}`);
  } catch (err) {
    if (err instanceof SocialN8nUnavailableError) throw err;
    // Network, timeout or a refused address: the reason stays in the log, not in the answer
    logger.warn("social.n8n_call_failed", { path, error_name: err instanceof Error ? err.name : "Error" });
    throw new SocialN8nUnavailableError("n8n could not be reached");
  }
}

/** Hands a provider event, already authenticated by CommerceOS, to n8n for normalization. Throws when n8n can't take it. */
export async function forwardRawToN8n(channel: ConnectedChannel, eventId: string, payload: Record<string, unknown>): Promise<void> {
  if (!isSocialChannel(channel.type)) throw new SocialN8nUnavailableError(`${channel.type} is not a social channel`);
  await callN8n(N8N_RAW_PATH, {
    schema: RAW_SCHEMA,
    channel_id: channel.id,
    channel_type: channel.type,
    event_id: eventId,
    received_at: new Date().toISOString(),
    ingest_url: `${requireBaseUrl()}/api/v1/social/ingest`,
    payload,
  });
}

/** Asks n8n to deliver a stored message at send_at (null: now). Throws when n8n can't take it. */
export async function enqueueSendInN8n(params: {
  messageId: string;
  channel: ConnectedChannel;
  sendAt: string | null;
  idempotencyKey: string;
}): Promise<void> {
  if (!isSocialChannel(params.channel.type)) throw new SocialN8nUnavailableError(`${params.channel.type} is not a social channel`);
  await callN8n(N8N_SEND_PATH, {
    schema: SEND_SCHEMA,
    message_id: params.messageId,
    channel_id: params.channel.id,
    channel_type: params.channel.type,
    send_at: params.sendAt,
    idempotency_key: params.idempotencyKey,
    dispatch_url: `${requireBaseUrl()}/api/v1/social/dispatch`,
  });
}

/**
 * Authenticates a call from n8n. Fails closed: with no COMMERCEOS_N8N_CALLBACK_TOKEN configured nothing is accepted.
 * Rate limited per token so a leaked token can't be used to flood the store.
 */
export async function assertN8nCallback(request: Request): Promise<void> {
  const expected = process.env.COMMERCEOS_N8N_CALLBACK_TOKEN;
  if (!expected || expected.length < 24) {
    throw new AppError("N8N_CALLBACK_NOT_CONFIGURED", "n8n callbacks are not configured on this server.", 503);
  }
  const given = request.headers.get(CALLBACK_TOKEN_HEADER) ?? "";
  const a = crypto.createHash("sha256").update(expected).digest();
  const b = crypto.createHash("sha256").update(given).digest();
  if (!crypto.timingSafeEqual(a, b)) throw new AuthenticationError("Invalid callback token.");
  await enforceRateLimit(`n8n-callback:${a.toString("hex").slice(0, 16)}`, 600, MINUTE);
}
