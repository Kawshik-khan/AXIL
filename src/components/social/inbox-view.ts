/** Shared by the inbox components: labels, times and who is answering. No React, no fetching. */
import type { Conversation, ConversationStatus } from "@/types/social";
import { controlOf } from "@/domains/social/conversations/conversation-control.state";
import { replyDue, type InboxAgentMode, type InboxConversation, type InboxQueue } from "@/domains/social/conversations/inbox-queue";

export type InboxTeam = NonNullable<Conversation["assigned_team_id"]>;

export const STATUS_LABELS: Record<ConversationStatus, string> = {
  OPEN: "Open",
  PENDING: "Pending",
  WAITING_CUSTOMER: "Waiting customer",
  WAITING_AGENT: "Waiting agent",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  SPAM: "Spam",
};

export const TEAM_LABELS: Record<InboxTeam, string> = {
  SALES: "Sales",
  SUPPORT: "Support",
  ORDERS: "Orders",
  RETURNS: "Returns",
  FINANCE: "Finance",
  GENERAL: "General",
};

export const QUEUE_LABELS: Record<InboxQueue, string> = {
  NEEDS_PERSON: "Needs a person",
  AGENT: "AI agent",
  TEAM: "With your team",
  DONE: "Resolved",
};

const CHANNEL_NAMES: Record<string, string> = {
  FACEBOOK_MESSENGER: "Messenger",
  INSTAGRAM: "Instagram",
  WHATSAPP: "WhatsApp",
  WEBSITE_CHAT: "Website",
  TELEGRAM: "Telegram",
  TIKTOK: "TikTok",
  EMAIL: "Email",
  SMS: "SMS",
  MARKETPLACE: "Marketplace",
};

export const channelName = (type: string): string => CHANNEL_NAMES[type] ?? type;

export function customerName(c: Pick<InboxConversation, "customer" | "external_conversation_id" | "id">): string {
  const name = c.customer ? `${c.customer.first_name} ${c.customer.last_name ?? ""}`.trim() : "";
  return name || `Customer ${String(c.external_conversation_id || c.id).slice(-6)}`;
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => [...part][0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export const clock = (iso: string): string => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function daysAgo(iso: string, now: number): number {
  const start = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  return Math.round((start(now) - start(Date.parse(iso))) / 86_400_000);
}

export function dayLabel(iso: string, now: number): string {
  const days = daysAgo(iso, now);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days === -1) return "Tomorrow";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(days > 300 ? { year: "numeric" } : {}) });
}

/** A list row's time: the clock today, otherwise the day. */
export const listTime = (iso: string, now: number): string => (daysAgo(iso, now) === 0 ? clock(iso) : dayLabel(iso, now));

export function duration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

export interface ReplyClock {
  /** Share of the reply time left, 0 to 1. */
  left: number;
  overdue: boolean;
  /** "16 min" left, or overdue by. */
  amount: string;
  /** When the reply is or was due. */
  at: string;
}

/** The reply time of a handed-off chat; undefined when it has none. */
export function replyClock(c: InboxConversation, now: number): ReplyClock | undefined {
  const times = replyDue(c);
  if (!times) return undefined;
  const due = Date.parse(times.due);
  const from = Date.parse(times.from);
  if (!Number.isFinite(due) || !Number.isFinite(from)) return undefined;
  const overdue = due <= now;
  return {
    left: overdue ? 0 : Math.min(1, (due - now) / Math.max(1, due - from)),
    overdue,
    amount: duration(Math.abs(due - now)),
    at: daysAgo(times.due, now) === 0 ? clock(times.due) : `${dayLabel(times.due, now)} ${clock(times.due)}`,
  };
}

export type Answering = "NEEDS" | "AGENT" | "ME" | "OTHER" | "DONE";

export function answeringOf(c: InboxConversation, viewerId: string): Answering {
  if (c.queue === "DONE") return "DONE";
  if (c.queue === "AGENT") return "AGENT";
  if (c.queue === "NEEDS_PERSON") return "NEEDS";
  return c.owner?.id === viewerId ? "ME" : "OTHER";
}

/** The control strip's sentence: who answers, and what that means for the next reply. */
export function answeringText(c: InboxConversation, viewerId: string, mode: InboxAgentMode, now: number): { title: string; detail: string } {
  switch (answeringOf(c, viewerId)) {
    case "DONE":
      return c.status === "SPAM"
        ? { title: "Marked as spam.", detail: "" }
        : { title: `${STATUS_LABELS[c.status]}.`, detail: "A new message reopens it." };
    case "AGENT":
      return { title: "✦ AI agent is answering.", detail: "Take over any time." };
    case "NEEDS": {
      const reply = replyClock(c, now);
      if (reply) return { title: "Needs a person.", detail: reply.overdue ? `Reply was due ${reply.at}.` : `Reply by ${reply.at}.` };
      if (controlOf(c).state === "ESCALATED") return { title: "Needs a person.", detail: "The AI agent handed this chat over." };
      if (mode === "OFF") return { title: "Needs a person.", detail: "The AI agent is off." };
      if (mode === "SHADOW") return { title: "Needs a person.", detail: "The AI agent only drafts replies." };
      return { title: "Needs a person.", detail: `The AI agent can't reply on ${channelName(c.channel_type)}.` };
    }
    default: {
      const who = c.owner?.id === viewerId ? "You are" : c.owner ? `${c.owner.name} is` : "Your team is";
      const waiting = c.awaiting_count ?? 0;
      return {
        title: `${who} answering.`,
        detail: waiting ? `${waiting} customer ${waiting === 1 ? "message is" : "messages are"} waiting.` : mode === "OFF" ? "" : "The AI agent is paused.",
      };
    }
  }
}

export const takaOf = (amount: number): string => `৳${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** "READY_TO_SHIP" → "Ready to ship" */
export const sentenceCase = (code: string): string => code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, " ");
