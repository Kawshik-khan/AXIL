/**
 * CommerceOS Phase 3: Social Commerce & Omnichannel Domain Types & Enums
 */

export type ChannelType =
  | "FACEBOOK_MESSENGER"
  | "INSTAGRAM"
  | "WHATSAPP"
  | "WEBSITE_CHAT"
  | "TIKTOK"
  | "TELEGRAM"
  | "EMAIL"
  | "SMS"
  | "MARKETPLACE";

export type ChannelStatus =
  | "ACTIVE"
  | "INACTIVE"
  | "ERROR"
  | "PENDING_SETUP"
  | "DISCONNECTED";

export interface ConnectedChannel {
  id: string;
  tenant_id: string;
  type: ChannelType;
  name: string;
  status: ChannelStatus;
  provider_account_id: string; // e.g. Facebook Page ID, WhatsApp Phone Number ID, IG Account ID
  external_page_id?: string;
  external_business_id?: string;
  external_phone_number_id?: string;
  credentials_encrypted: string; // AES-256-GCM encrypted JSON payload
  configuration: {
    welcome_message?: string;
    auto_reply_enabled?: boolean;
    webhook_verify_token?: string;
    widget_color?: string;
    widget_position?: "bottom-right" | "bottom-left";
    allowed_domains?: string[];
    [key: string]: unknown;
  };
  last_sync_at?: string;
  last_webhook_at?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export type ConversationStatus =
  | "OPEN"
  | "PENDING"
  | "WAITING_CUSTOMER"
  | "WAITING_AGENT"
  | "RESOLVED"
  | "CLOSED"
  | "SPAM";

export type ConversationPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type ConversationMode = "HUMAN" | "AUTOMATION" | "AI";

export type ConversationSource =
  | "FACEBOOK"
  | "INSTAGRAM"
  | "WHATSAPP"
  | "WEBSITE"
  | "OTHER";

export interface Conversation {
  id: string;
  tenant_id: string;
  channel_id: string;
  channel_type: ChannelType;
  customer_id: string;
  external_conversation_id: string;
  status: ConversationStatus;
  priority: ConversationPriority;
  mode: ConversationMode;
  automation_paused: boolean;
  assigned_user_id?: string;
  assigned_team_id?: "SALES" | "SUPPORT" | "ORDERS" | "RETURNS" | "FINANCE" | "GENERAL";
  last_message_at: string;
  last_inbound_at?: string;
  last_outbound_at?: string;
  unread_count: number;
  subject?: string;
  tags: string[];
  source: ConversationSource;
  source_campaign?: string;
  source_ad?: string;
  source_post?: string;
  source_story?: string;
  source_url?: string;
  referral_metadata?: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type MessageDirection = "INBOUND" | "OUTBOUND";

export type MessageSenderType = "CUSTOMER" | "AGENT" | "SYSTEM" | "BOT";

export type MessageType =
  | "TEXT"
  | "IMAGE"
  | "VIDEO"
  | "AUDIO"
  | "FILE"
  | "LOCATION"
  | "STICKER"
  | "PRODUCT"
  | "ORDER"
  | "SYSTEM_EVENT"
  | "INTERNAL_NOTE"
  | "UNKNOWN";

export type MessageStatus =
  | "RECEIVED"
  | "PROCESSING"
  | "PROCESSED"
  | "QUEUED"
  | "SENDING"
  | "SENT"
  | "DELIVERED"
  | "READ"
  | "FAILED"
  | "CANCELLED";

export interface Attachment {
  id: string;
  tenant_id: string;
  message_id: string;
  storage_key: string;
  mime_type: string;
  file_name: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  external_url: string;
  created_at: string;
}

export interface Message {
  id: string;
  tenant_id: string;
  conversation_id: string;
  external_message_id?: string;
  client_message_id?: string;
  idempotency_key?: string;
  direction: MessageDirection;
  sender_type: MessageSenderType;
  sender_id?: string; // User ID if AGENT, or Customer ID if CUSTOMER
  sender_external_id?: string;
  message_type: MessageType;
  text: string;
  normalized_text?: string;
  status: MessageStatus;
  reply_to_message_id?: string;
  provider_timestamp?: string;
  sent_at?: string;
  delivered_at?: string;
  read_at?: string;
  failed_at?: string;
  failure_reason?: string;
  retry_count: number;
  attachments?: Attachment[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CustomerIdentity {
  id: string;
  tenant_id: string;
  customer_id: string;
  channel_id: string;
  channel_type: ChannelType;
  external_user_id: string; // PSID, IGSID, Phone number, or Website Anonymous ID
  external_username?: string;
  display_name?: string;
  phone?: string;
  email?: string;
  metadata: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
}

export interface ConversationAssignment {
  id: string;
  tenant_id: string;
  conversation_id: string;
  assigned_user_id?: string;
  assigned_team_id?: string;
  assigned_by: string; // Actor User ID or "SYSTEM"
  assigned_at: string;
  unassigned_at?: string;
  notes?: string;
}

export interface ConversationTag {
  id: string;
  tenant_id: string;
  name: string;
  color: string;
  is_system: boolean;
  created_at: string;
}

export type LeadStatus = "NEW" | "CONTACTED" | "QUALIFIED" | "CONVERTED" | "LOST";

export interface Lead {
  id: string;
  tenant_id: string;
  customer_id: string;
  conversation_id?: string;
  source: ConversationSource;
  status: LeadStatus;
  intent?: string;
  assigned_to?: string;
  estimated_value?: number;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export type QuickReplyCategory =
  | "Sales"
  | "Support"
  | "Order"
  | "Payment"
  | "Shipping"
  | "Returns";

export interface QuickReply {
  id: string;
  tenant_id: string;
  title: string;
  content: string;
  channel_type?: ChannelType;
  category: QuickReplyCategory;
  active: boolean;
  shortcut?: string;
  created_at: string;
}

export interface DaySchedule {
  day: "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";
  is_open: boolean;
  open_time: string; // "09:00"
  close_time: string; // "20:00"
}

export interface BusinessHours {
  id: string;
  tenant_id: string;
  timezone: string; // "Asia/Dhaka"
  schedule: DaySchedule[];
  auto_reply_enabled: boolean;
  offline_message: string;
  created_at: string;
  updated_at: string;
}

export interface ChatSession {
  id: string;
  tenant_id: string;
  conversation_id: string;
  anonymous_id: string;
  customer_id?: string;
  page_url: string;
  referrer?: string;
  user_agent?: string;
  ip_address?: string;
  started_at: string;
  last_seen_at: string;
}

export interface NormalizedIncomingMessage {
  channelType: ChannelType;
  channelId: string;
  externalEventId: string;
  externalMessageId: string;
  externalConversationId: string;
  externalSenderId: string;
  senderProfile: {
    displayName?: string;
    username?: string;
    phone?: string;
    email?: string;
    avatarUrl?: string;
  };
  direction: MessageDirection;
  messageType: MessageType;
  text: string;
  attachments?: Array<{
    type: string;
    url: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
  }>;
  sourceMetadata?: {
    campaign?: string;
    adId?: string;
    postId?: string;
    storyId?: string;
    pageUrl?: string;
    [key: string]: unknown;
  };
  timestamp: string;
  rawPayload: Record<string, unknown>;
}

export interface OutboundWebhookDelivery {
  id: string;
  tenant_id: string;
  subscription_id: string;
  event_id: string;
  event_type: string;
  target_url: string;
  status: "SUCCESS" | "FAILED" | "RETRYING";
  attempt_count: number;
  response_code?: number;
  error_message?: string;
  created_at: string;
  delivered_at?: string;
}
