/**
 * Merchant notifications (owner alerts): which alerts a workspace gets, and where they go. One record per workspace.
 * Delivered by the CommerceOS alerts bot on Telegram (src/domains/notifications); the scheduled jobs produce them.
 */

/** The alerts a workspace can switch on or off. */
export interface NotificationAlerts {
  /** 9 PM in the shop's timezone: the day's orders, revenue, pending orders, low-stock count. */
  daily_summary: boolean;
  /** 8 AM: items at or below their reorder point. */
  low_stock: boolean;
  /** Daily: deliveries that failed or came back in the last day. */
  failed_deliveries: boolean;
  /** Weekly: cash-on-delivery orders delivered per courier, to check against payouts. */
  cod_weekly: boolean;
  /** As it happens: a customer chat was handed to a person (the AI escalated it or the customer asked). */
  chat_escalated: boolean;
  /** As it happens: an order at or above the workspace's high-value threshold. */
  new_order_high_value: boolean;
  /** As it happens: an online payment (bKash / SSLCommerz checkout) failed. */
  payment_failed: boolean;
}

export type NotificationAlertKey = keyof NotificationAlerts;

/** Alerts sent as events happen (through the owner-alert outbox), rather than by a scheduled job. */
export const EVENT_ALERT_KEYS = ["chat_escalated", "new_order_high_value", "payment_failed"] as const;
export type EventAlertKey = (typeof EVENT_ALERT_KEYS)[number];

export const DEFAULT_NOTIFICATION_ALERTS: NotificationAlerts = {
  daily_summary: true,
  low_stock: true,
  failed_deliveries: true,
  cod_weekly: false,
  // A customer waiting for a person is the one event that needs the owner now; the others are opt-in
  chat_escalated: true,
  new_order_high_value: false,
  payment_failed: false,
};

/** Default high-value order threshold in BDT, until the workspace sets its own (Settings → Notifications). */
export const DEFAULT_HIGH_VALUE_ORDER_BDT = 5000;

/** Owner Assistant settings for the linked chat (ADR-127). */
export interface OwnerAssistantSettings {
  /** Answer questions in the linked chat (on by default; a private chat is the owner's own). */
  questions_enabled: boolean;
  /** Also answer in a linked group chat, when the bot is mentioned or replied to (off: everyone in a group sees the numbers). */
  group_questions: boolean;
  /** Orders at or above this total (BDT) raise `new_order_high_value`. */
  high_value_order_bdt: number;
  /** Event alerts wait until quiet hours end (shop's timezone, 0-23). Equal hours mean no quiet hours. */
  quiet_hours: { start_hour: number; end_hour: number };
}

export const DEFAULT_OWNER_ASSISTANT_SETTINGS: OwnerAssistantSettings = {
  questions_enabled: true,
  group_questions: false,
  high_value_order_bdt: DEFAULT_HIGH_VALUE_ORDER_BDT,
  quiet_hours: { start_hour: 0, end_hour: 0 },
};

export interface NotificationSettingsRecord {
  /** `ns_<tenant id>`: one per workspace */
  id: string;
  tenant_id: string;
  alerts: NotificationAlerts;
  /** Optional workspace-configured alerts bot token (encrypted with CREDENTIALS_ENCRYPTION_KEY). */
  bot_token_encrypted?: string;
  /** Verified @username of the workspace-configured alerts bot. */
  bot_username?: string;
  /** The workspace alerts bot's Telegram id (the token's numeric prefix): one workspace per bot, never a customer bot. */
  bot_id?: string;
  /** The workspace bot's own webhook address key (random, 32 characters): `/api/v1/notifications/telegram/webhook/<key>`. */
  bot_webhook_key?: string;
  /** The workspace bot's random webhook secret, encrypted with CREDENTIALS_ENCRYPTION_KEY (ADR-128). */
  bot_webhook_secret_encrypted?: string;
  /** The Telegram chat the alerts go to (a person or a group), linked by pressing Start on the alerts bot. */
  telegram?: {
    chat_id: string;
    /** What the merchant sees: the group title, @username or first name. */
    chat_label: string;
    linked_at: string;
    linked_by_user_id: string;
    /** The bot the chat pressed Start on (ADR-128). A chat only hears from, and is only answered through, that bot. */
    via?: "platform" | "workspace";
    /** That bot's id. */
    bot_id?: string;
  };
  /** A pending one-time link (SHA-256 of the code in the bot's start link), valid for 15 minutes. */
  link?: {
    code_hash: string;
    expires_at: string;
    requested_by_user_id: string;
  };
  last_test_at?: string;
  /** Owner Assistant settings; missing fields take DEFAULT_OWNER_ASSISTANT_SETTINGS. */
  assistant?: Partial<OwnerAssistantSettings>;
  created_at: string;
  updated_at: string;
}

/** What a delivery attempt did: never "sent" unless Telegram accepted the message. */
export type NotificationDeliveryStatus = "SENT" | "NOT_SENT" | "FAILED";

export interface NotificationDeliveryResult {
  status: NotificationDeliveryStatus;
  /** Why it wasn't sent (not connected, alert off, bot not configured) or what failed. */
  reason?: string;
}
