import { z } from "zod";

/**
 * Contracts between CommerceOS and n8n for social channels (Telegram, Messenger, Instagram, WhatsApp). Connector plan C3,
 * docs/connector-implementation-plan.md.
 *
 *   inbound   provider -> CommerceOS (verifies the provider signature, finds the channel) -> n8n "raw" webhook
 *             -> n8n normalizes -> POST /api/v1/social/ingest   (canonical message, this file)
 *   outbound  CommerceOS stores the message QUEUED -> n8n "send" webhook (schedule + retries + waits)
 *             -> POST /api/v1/social/dispatch {message_id} at send time -> CommerceOS calls the provider
 *
 * Tenant tokens never go to n8n. The tenant is never a field here: CommerceOS resolves it from the channel / message row.
 */

export const SOCIAL_CHANNEL_TYPES = ["TELEGRAM", "FACEBOOK_MESSENGER", "INSTAGRAM", "WHATSAPP"] as const;
export type SocialChannelType = (typeof SOCIAL_CHANNEL_TYPES)[number];

export const RAW_SCHEMA = "commerceos.social.raw.v1";
export const INBOUND_SCHEMA = "commerceos.social.message.v1";
export const SEND_SCHEMA = "commerceos.social.send.v1";

export const N8N_RAW_PATH = "commerceos-social-raw";
export const N8N_SEND_PATH = "commerceos-social-send";

/** CommerceOS -> n8n: a provider event CommerceOS has already authenticated. */
export interface RawSocialEnvelope {
  schema: typeof RAW_SCHEMA;
  channel_id: string;
  channel_type: SocialChannelType;
  /** Stable id of the provider event (Telegram update_id, Meta entry id + time), for de-duplication. */
  event_id: string;
  received_at: string;
  /** Where n8n posts the normalized result. */
  ingest_url: string;
  payload: Record<string, unknown>;
}

/** CommerceOS -> n8n: please deliver this stored message at send_at (or now). No message content is sent. */
export interface SendSocialEnvelope {
  schema: typeof SEND_SCHEMA;
  message_id: string;
  channel_id: string;
  channel_type: SocialChannelType;
  /** ISO time; null means as soon as possible. */
  send_at: string | null;
  idempotency_key: string;
  /** n8n POSTs {"message_id": "..."} here when it is time. */
  dispatch_url: string;
}

const IsoTime = z.string().datetime({ offset: true });

const InboundMessage = z
  .object({
    external_message_id: z.string().min(1).max(200),
    external_sender_id: z.string().min(1).max(200),
    external_conversation_id: z.string().min(1).max(200).optional(),
    sender: z
      .object({
        display_name: z.string().max(200).optional(),
        username: z.string().max(200).optional(),
        phone: z.string().max(40).optional(),
      })
      .strict()
      .default({}),
    message_type: z.enum(["TEXT", "IMAGE", "VIDEO", "AUDIO", "FILE", "LOCATION", "STICKER", "UNKNOWN"]).default("TEXT"),
    text: z.string().max(4096).default(""),
    attachments: z
      .array(
        z
          .object({
            type: z.string().max(40),
            url: z.string().url().max(2048),
            file_name: z.string().max(255).optional(),
            mime_type: z.string().max(120).optional(),
            size: z.number().int().nonnegative().optional(),
          })
          .strict()
      )
      .max(10)
      .default([]),
    timestamp: IsoTime,
  })
  .strict();

const InboundStatus = z
  .object({
    external_message_id: z.string().min(1).max(200),
    status: z.enum(["DELIVERED", "READ", "FAILED"]),
    timestamp: IsoTime,
    failure_reason: z.string().max(300).optional(),
  })
  .strict();

/** n8n -> CommerceOS: the normalized result for one raw event. */
export const CanonicalInboundSchema = z
  .object({
    schema: z.literal(INBOUND_SCHEMA),
    channel_id: z.string().min(1).max(120),
    event_id: z.string().min(1).max(300),
    messages: z.array(InboundMessage).max(50).default([]),
    statuses: z.array(InboundStatus).max(50).default([]),
  })
  .strict();
export type CanonicalInbound = z.infer<typeof CanonicalInboundSchema>;

/** n8n -> CommerceOS at send time. Content, recipient and credentials all come from the stored message and channel. */
export const DispatchRequestSchema = z.object({ message_id: z.string().min(1).max(120) }).strict();
