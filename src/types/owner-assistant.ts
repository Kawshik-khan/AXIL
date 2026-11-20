/**
 * Owner Assistant (ADR-127): the shop owner asks questions about their own business (sales, stock, deliveries,
 * returns, cash on delivery, escalated chats) from the dashboard or their linked Telegram chat, and gets answers
 * grounded in the shop's data. Read-only: it never changes orders, prices, stock or payments, and never messages
 * customers.
 */

export type OwnerAssistantChannel = "DASHBOARD" | "TELEGRAM";

/**
 * One question and its answer. A Telegram question is stored PENDING by the webhook and answered by the background
 * worker (the model call never runs inside the webhook's store unit); a dashboard question is answered in the request.
 */
export interface OwnerAssistantTurnRecord {
  id: string;
  tenant_id: string;
  channel: OwnerAssistantChannel;
  /** The conversation this turn belongs to: `user:<user id>` on the dashboard, `tg:<chat id>` on Telegram. */
  chat_key: string;
  /** The workspace user the answer was computed for (the signed-in user, or the person who linked the Telegram chat). */
  user_id: string;
  question: string;
  status: "PENDING" | "ANSWERING" | "ANSWERED" | "FAILED";
  answer?: string;
  /** Tools the answer used, in call order (names only). */
  tools_used?: string[];
  /** LIVE: written by the model; BASIC: the offline answer (no model configured); REFUSED: a guard answered instead. */
  mode?: "LIVE" | "BASIC" | "REFUSED";
  /** Numbers in the model's reply that no tool returned, removed or rewritten by the grounding check. */
  ungrounded_numbers?: string[];
  /** Telegram: the message being answered, so the reply quotes it. */
  telegram_message_id?: number;
  claimed_at?: string;
  attempts?: number;
  error_code?: string;
  agent_run_id?: string;
  created_at: string;
  answered_at?: string;
}

/** An event alert waiting to be delivered (outbox). Created in the same unit as the event, sent by the worker. */
export interface OwnerAlertRecord {
  id: string;
  tenant_id: string;
  alert_key: string;
  text: string;
  /** One alert per dedupe key (e.g. one per order, one per escalated chat per 30 minutes). */
  dedupe_key: string;
  /** SENDING: claimed by a worker. One left SENDING is never sent again (Telegram may have it): it becomes FAILED. */
  status: "PENDING" | "SENDING" | "SENT" | "NOT_SENT" | "FAILED";
  /** Not before this time (quiet hours defer delivery). */
  deliver_after: string;
  attempts: number;
  claimed_at?: string;
  reason?: string;
  created_at: string;
  sent_at?: string;
}
