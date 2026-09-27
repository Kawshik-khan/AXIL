import {
  ChannelType,
  NormalizedIncomingMessage,
  MessageStatus,
} from "@/types/social";

export interface ChannelCredentials {
  accessToken?: string;
  appSecret?: string;
  verifyToken?: string;
  pageId?: string;
  phoneNumberId?: string;
  businessAccountId?: string;
  webhookSecret?: string;
  apiKey?: string;
  [key: string]: unknown;
}

export interface SendMessageResult {
  externalMessageId: string;
  status: MessageStatus;
  providerTimestamp?: string;
  rawResponse?: Record<string, unknown>;
}

export interface DeliveryReceipt {
  externalMessageId: string;
  recipientId: string;
  status: "DELIVERED" | "READ" | "FAILED";
  timestamp: string;
  failureReason?: string;
}

export interface UserProfileResult {
  displayName?: string;
  username?: string;
  avatarUrl?: string;
  phone?: string;
  email?: string;
  gender?: string;
}

export interface IChannelProvider {
  readonly channelType: ChannelType;

  /**
   * Cryptographically verify an incoming webhook request
   */
  verifyWebhook(
    payload: string | Buffer,
    signature: string | null,
    headers: Record<string, string | string[] | undefined>,
    credentials: ChannelCredentials
  ): boolean;

  /**
   * Parse raw webhook payload and normalize incoming messages/events
   */
  normalizeIncomingEvent(
    rawPayload: Record<string, unknown>,
    channelId: string
  ): NormalizedIncomingMessage[];

  /**
   * Parse incoming delivery receipts (delivered, read, failed)
   */
  parseDeliveryReceipts(
    rawPayload: Record<string, unknown>
  ): DeliveryReceipt[];

  /**
   * Send outbound text message to external recipient
   */
  sendTextMessage(
    credentials: ChannelCredentials,
    recipientId: string,
    text: string,
    options?: { replyToMessageId?: string; metadata?: Record<string, unknown> }
  ): Promise<SendMessageResult>;

  /**
   * Send outbound media message (image, video, audio, file)
   */
  sendMediaMessage(
    credentials: ChannelCredentials,
    recipientId: string,
    mediaType: "IMAGE" | "VIDEO" | "AUDIO" | "FILE",
    mediaUrl: string,
    options?: { caption?: string; fileName?: string }
  ): Promise<SendMessageResult>;

  /**
   * Send structured template message (e.g. WhatsApp HSM template)
   */
  sendTemplateMessage(
    credentials: ChannelCredentials,
    recipientId: string,
    templateName: string,
    parameters: Record<string, string>
  ): Promise<SendMessageResult>;

  /**
   * Mark message or thread as read in external provider
   */
  markMessageRead(
    credentials: ChannelCredentials,
    recipientId: string,
    messageId?: string
  ): Promise<boolean>;

  /**
   * Retrieve external customer user profile if supported by channel
   */
  getUserProfile(
    credentials: ChannelCredentials,
    externalUserId: string
  ): Promise<UserProfileResult | null>;

  /**
   * Test channel connection credentials with provider API
   */
  validateCredentials(credentials: ChannelCredentials): Promise<{ valid: boolean; error?: string }>;
}
