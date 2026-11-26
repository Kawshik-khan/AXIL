"use client";

/**
 * The handoff context card (FX-84), in the customer rail of a handed-off chat: why the agent handed off, what the
 * customer said they want, the open quote and this chat's orders, and when a person should have answered.
 * Customer-stated details are shown as unverified.
 */
import React from "react";
import { isCurrentHandoff, type InboxConversation, type InboxOrderDraft } from "@/domains/social/conversations/inbox-queue";
import { replyClock, sentenceCase, takaOf } from "./inbox-view";
import styles from "./Inbox.module.css";

export interface HandoffCardData {
  reason: string;
  intent?: string;
  summary: string;
  priority: string;
  suggested_action?: string;
  slots?: string[];
  open_quote?: { id: string; grand_total: number; district: string };
  order_refs?: string[];
  script?: string;
  created_at: string;
  sla_due_at: string;
}

export function isHandoffCard(value: unknown): value is HandoffCardData {
  const v = value as Partial<HandoffCardData> | null;
  return Boolean(v && typeof v.reason === "string" && typeof v.summary === "string" && typeof v.sla_due_at === "string");
}

/** The handoff card that applies now: one stays on the chat after the agent gets it back, and then says nothing. */
export function currentHandoff(c: InboxConversation): HandoffCardData | undefined {
  const card = c.metadata?.handoff_card;
  return isHandoffCard(card) && isCurrentHandoff(c, card.created_at) ? card : undefined;
}

/** The order the agent prepared for a person to review, and the open ticket it is on. */
export function draftOrderOf(c: InboxConversation): { draft: InboxOrderDraft; ticketId: string } | undefined {
  const ticket = c.escalation;
  return ticket?.order_draft && ticket.draft_ticket_id ? { draft: ticket.order_draft, ticketId: ticket.draft_ticket_id } : undefined;
}

const RADIUS = 58;
const LENGTH = 2 * Math.PI * RADIUS;

export const HandoffContextCard: React.FC<{ conversation: InboxConversation; now: number }> = ({ conversation, now }) => {
  const card = currentHandoff(conversation);
  const ticket = conversation.queue === "NEEDS_PERSON" ? conversation.escalation : undefined;
  if (!card && !ticket) return null;

  const reply = conversation.queue === "NEEDS_PERSON" ? replyClock(conversation, now) : undefined;
  return (
    <section className={`${styles.railCard} ${styles.brief}`} aria-label="Handoff brief">
      <h3>✦ Handoff brief</h3>
      {reply && (
        <div className={styles.briefRing}>
          <svg width={132} height={132} viewBox="0 0 132 132" aria-hidden="true">
            <circle cx={66} cy={66} r={RADIUS} strokeWidth={11} className={styles.ringTrack} />
            <circle
              cx={66}
              cy={66}
              r={RADIUS}
              strokeWidth={11}
              className={reply.overdue ? styles.ringOver : styles.ringLeft}
              strokeDasharray={reply.overdue ? undefined : `${reply.left * LENGTH} ${LENGTH}`}
            />
          </svg>
          <div>
            <b>{reply.amount}</b>
            <span>{reply.overdue ? "overdue" : `by ${reply.at}`}</span>
          </div>
        </div>
      )}
      <p>{card ? card.summary : ticket?.trigger_reason}</p>
      {card?.suggested_action && <p>Suggested: {card.suggested_action}</p>}
      {card?.open_quote && (
        <p>
          Open quote: {takaOf(card.open_quote.grand_total)} to {card.open_quote.district}, waiting for the customer&apos;s yes.
        </p>
      )}
      {card?.order_refs && card.order_refs.length > 0 && <p>Orders in this chat: {card.order_refs.join(", ")}</p>}
      {card?.script && <p>Reply in {card.script === "bangla" ? "Bangla script" : "English letters"}.</p>}
      {card?.slots && card.slots.length > 0 && (
        <div>
          <div className={styles.briefLabel}>Customer said, not verified</div>
          <div className={styles.briefChips}>
            {card.slots.map((slot) => (
              <span key={slot}>{slot}</span>
            ))}
          </div>
        </div>
      )}
      <div className={styles.briefChips}>
        <span>{sentenceCase(card?.priority ?? ticket?.priority ?? "NORMAL")} priority</span>
        {card?.intent && <span>{card.intent.charAt(0).toUpperCase() + card.intent.slice(1)}</span>}
      </div>
    </section>
  );
};
