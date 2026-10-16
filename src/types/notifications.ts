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
}

export type NotificationAlertKey = keyof NotificationAlerts;

export const DEFAULT_NOTIFICATION_ALERTS: NotificationAlerts = {
  daily_summary: true,
  low_stock: true,
  failed_deliveries: true,
  cod_weekly: false,
};

export interface NotificationSettingsRecord {
  /** `ns_<tenant id>`: one per workspace */
  id: string;
  tenant_id: string;
  alerts: NotificationAlerts;
  /** The Telegram chat the alerts go to (a person or a group), linked by pressing Start on the alerts bot. */
  telegram?: {
    chat_id: string;
    /** What the merchant sees: the group title, @username or first name. */
    chat_label: string;
    linked_at: string;
    linked_by_user_id: string;
  };
  /** A pending one-time link (SHA-256 of the code in the bot's start link), valid for 15 minutes. */
  link?: {
    code_hash: string;
    expires_at: string;
    requested_by_user_id: string;
  };
  last_test_at?: string;
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
