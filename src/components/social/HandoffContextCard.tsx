"use client";

/**
 * The handoff context card (FX-84) at the top of a handed-off inbox thread: why the agent handed off, what the customer
 * said they want, the open quote and this chat's orders, and when a person should have answered. Customer-stated
 * details are shown as unverified.
 */
import React from "react";
import { AlertTriangle } from "lucide-react";
import styles from "./SocialInbox.module.css";

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

export function HandoffContextCard({ card }: { card: HandoffCardData }) {
  const due = new Date(card.sla_due_at);
  const overdue = due.getTime() < Date.now();
  const time = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className={styles.internalNoteRow} role="note" aria-label="Handoff context">
      <div className={styles.internalNoteBubble}>
        <div className={styles.internalNoteHeader}>
          <AlertTriangle size={12} />
          <span>
            HANDOFF • {card.priority} • {overdue ? `reply overdue since ${time(due)}` : `reply by ${time(due)}`}
          </span>
        </div>
        <div>
          <strong>{card.intent ?? card.reason}</strong>: {card.summary}
        </div>
        {card.suggested_action && <div>Suggested: {card.suggested_action}</div>}
        {card.open_quote && (
          <div>
            Open quote: ৳{card.open_quote.grand_total.toLocaleString("en-BD")} to {card.open_quote.district} (waiting for the customer&apos;s yes)
          </div>
        )}
        {card.order_refs && card.order_refs.length > 0 && <div>Orders in this chat: {card.order_refs.join(", ")}</div>}
        {card.slots && card.slots.length > 0 && (
          <div>
            Customer said (unverified):
            <ul>
              {card.slots.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        {card.script && <div>Reply in: {card.script === "bangla" ? "Bangla script" : "English letters"}</div>}
      </div>
    </div>
  );
}
