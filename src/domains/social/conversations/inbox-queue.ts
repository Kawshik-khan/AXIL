/**
 * The inbox's queues: who has to act on a chat next. Types and pure functions only, so the API and the inbox UI sort
 * chats the same way. Who answers comes from the chat's control (ADR-121), never from the legacy fields.
 */
import type { Conversation, MessageSenderType, MessageType } from "@/types/social";
import type { AgentHitlEscalationRecord } from "@/types/ai";
import type { Customer } from "@/types/commerce";
import { controlOf } from "./conversation-control.state";

export const INBOX_QUEUES = ["NEEDS_PERSON", "AGENT", "TEAM", "DONE"] as const;
export type InboxQueue = (typeof INBOX_QUEUES)[number];

/** A queue, or OPEN for every queue except DONE. */
export const INBOX_QUEUE_FILTERS = [...INBOX_QUEUES, "OPEN"] as const;
export type InboxQueueFilter = (typeof INBOX_QUEUE_FILTERS)[number];

/** What the customer agent does in this workspace: replies, drafts only, or nothing. */
export type InboxAgentMode = "AUTONOMOUS" | "SHADOW" | "OFF";

export interface InboxLastMessage {
  text: string;
  direction: "INBOUND" | "OUTBOUND";
  sender_type: MessageSenderType;
  message_type: MessageType;
  is_ai: boolean;
  created_at: string;
}

export type InboxOrderDraft = NonNullable<AgentHitlEscalationRecord["order_draft"]>;

/** The open ticket of the chat's current handoff. */
export interface InboxEscalation {
  id: string;
  trigger_reason: string;
  priority: string;
  sla_due_at: string;
  created_at: string;
  /** The newest draft among the chat's open tickets, and the ticket it is on. */
  order_draft?: InboxOrderDraft;
  draft_ticket_id?: string;
}

export interface InboxConversation extends Conversation {
  customer?: Customer;
  channel_name?: string;
  queue: InboxQueue;
  /** Whether the customer agent replies on this chat's channel: false when it is off, drafts only, or can't send there. */
  agent_answers: boolean;
  /** The team member who has the chat, when one is recorded. */
  owner?: { id: string; name: string };
  last_message?: InboxLastMessage;
  escalation?: InboxEscalation;
}

export interface InboxMeta {
  total: number;
  agent_mode: InboxAgentMode;
  viewer_id: string;
  queues: Record<InboxQueue, number> & {
    /** TEAM chats the signed-in person has. */
    mine: number;
    /** Since when the longest-waiting NEEDS_PERSON chat has waited. */
    oldest_waiting_since: string | null;
  };
  /** Chats per channel type in the selected queue, before the channel filter. */
  channels: Record<string, number>;
}

/**
 * The queue of a chat. A chat left to the agent on a channel where the agent doesn't reply needs a person: nobody else
 * would answer it.
 */
export function queueOf(
  conversation: Pick<Conversation, "status" | "control" | "automation_paused" | "metadata" | "updated_at">,
  agentAnswers: boolean
): InboxQueue {
  if (conversation.status === "RESOLVED" || conversation.status === "CLOSED" || conversation.status === "SPAM") return "DONE";
  const { state } = controlOf(conversation);
  if (state === "ESCALATED") return "NEEDS_PERSON";
  if (state === "HUMAN") return "TEAM";
  return agentAnswers ? "AGENT" : "NEEDS_PERSON";
}

interface HandoffTimes {
  created_at?: string;
  sla_due_at?: string;
}

/** A card or ticket is written with the handoff, not at the same instant. */
const HANDOFF_SLACK_MS = 60_000;
/** How long before a person took the chat over its handoff may have been. */
const TAKEOVER_WINDOW_MS = 24 * 60 * 60_000;

/**
 * Whether a card or ticket from `createdAt` is about the chat's current handoff. Nothing removes them when the agent gets
 * the chat back, so an earlier one must not set the next one's reply time, reason or order draft.
 */
export function isCurrentHandoff(conversation: Pick<Conversation, "control" | "automation_paused" | "metadata" | "updated_at">, createdAt: string): boolean {
  const control = controlOf(conversation);
  if (control.state === "BOT") return false;
  if (!conversation.control) return true; // derived (before ADR-121): when it was handed over isn't known
  const slack = control.state === "ESCALATED" ? HANDOFF_SLACK_MS : TAKEOVER_WINDOW_MS;
  return Date.parse(createdAt) >= Date.parse(control.changed_at) - slack;
}

/** The handoff card's times, when the card is about the current handoff. */
function currentCard(conversation: Pick<Conversation, "control" | "automation_paused" | "metadata" | "updated_at">): HandoffTimes | undefined {
  const card = conversation.metadata?.handoff_card as HandoffTimes | undefined;
  return card?.created_at && isCurrentHandoff(conversation, card.created_at) ? card : undefined;
}

/** When a person should have answered: the handoff card's or the ticket's time. Undefined when neither set one. */
export function replyDue(
  conversation: Pick<InboxConversation, "metadata" | "escalation" | "control" | "automation_paused" | "updated_at">
): { from: string; due: string } | undefined {
  if (controlOf(conversation).state !== "ESCALATED") return undefined;
  const card = currentCard(conversation);
  if (card?.created_at && card.sla_due_at) return { from: card.created_at, due: card.sla_due_at };
  if (conversation.escalation) return { from: conversation.escalation.created_at, due: conversation.escalation.sla_due_at };
  return undefined;
}

/** Since when a NEEDS_PERSON chat has waited. */
export function waitingSince(conversation: Conversation): string {
  return conversation.awaiting_since ?? currentCard(conversation)?.created_at ?? conversation.last_inbound_at ?? conversation.last_message_at;
}
