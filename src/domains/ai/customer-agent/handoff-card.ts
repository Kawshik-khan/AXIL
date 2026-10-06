/**
 * The handoff context card (FX-84, audit F21): what a staff member needs to pick a chat up without re-reading it.
 * Built from server data only (slots from the customer's own messages, the open quote, this chat's orders); stored on
 * the conversation (`metadata.handoff_card`) and shown at the top of the inbox thread.
 */
import { db } from "@/infrastructure/db";
import type { CustomerAgentPrincipal } from "./principal";
import { visibleOrders } from "./principal";
import { conversationSlots, chatMessages } from "./runtime";
import { replyScript } from "./output";

export interface HandoffCard {
  reason: string;
  intent?: string;
  summary: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  suggested_action?: string;
  /** Facts the customer stated in this chat; unverified. */
  slots: string[];
  open_quote?: { id: string; grand_total: number; district: string; expires_at: string };
  order_refs: string[];
  script: "bangla" | "latin";
  created_at: string;
  /** When a person should have answered, by priority. */
  sla_due_at: string;
}

const SLA_MINUTES: Record<HandoffCard["priority"], number> = { URGENT: 5, HIGH: 15, NORMAL: 60, LOW: 240 };

/** Reasons the customer agent hands off with, read as the customer's intent. */
const INTENT: Record<string, string> = {
  customer_request: "wants a person", angry: "complaint", payment_problem: "payment issue", cancellation: "cancel an order",
  return_or_exchange: "return or exchange", address_change: "change delivery address", damaged_or_wrong_item: "damaged or wrong item",
  wholesale: "wholesale order", could_not_answer: "question the agent couldn't answer", other: "other",
};

export function slaDueAt(priority: HandoffCard["priority"], from = Date.now()): string {
  return new Date(from + SLA_MINUTES[priority] * 60_000).toISOString();
}

/** The parts of the card only the customer agent knows (slots, quote, orders, script). */
export function customerAgentCardContext(pr: CustomerAgentPrincipal, reason: string): Partial<HandoffCard> {
  const open = db
    .getConversationQuotes(pr.tenantId, pr.conversationId)
    .filter((q) => q.status === "QUOTED" && Date.parse(q.expires_at) > Date.now())
    .pop();
  const lastCustomer = [...chatMessages(pr.tenantId, pr.conversationId, 20)].reverse().find((m) => m.sender_type === "CUSTOMER");
  return {
    intent: INTENT[reason] ?? reason,
    slots: conversationSlots(pr),
    ...(open ? { open_quote: { id: open.id, grand_total: open.grand_total, district: open.district, expires_at: open.expires_at } } : {}),
    order_refs: visibleOrders(pr, 5).map((o) => `${o.order_number} (${o.status})`),
    script: replyScript(lastCustomer?.text ?? ""),
  };
}
