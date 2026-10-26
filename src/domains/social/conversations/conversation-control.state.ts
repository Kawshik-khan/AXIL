/**
 * Reading a chat's control (ADR-121). No imports beyond types, so server code and the inbox UI read it the same way.
 * Changing it is ConversationControlService.transition's job only.
 */
import type { Conversation, ConversationControl, ConversationControlState } from "@/types/social";

/** The chat's control, derived for rows written before ADR-121 (never written on read). */
export function controlOf(conversation: Pick<Conversation, "control" | "automation_paused" | "metadata" | "updated_at">): ConversationControl {
  if (conversation.control) return conversation.control;
  const state: ConversationControlState = !conversation.automation_paused
    ? "BOT"
    : conversation.metadata?.handoff_card
      ? "ESCALATED"
      : "HUMAN";
  return { state, version: 0, reason: "derived", changed_by: "system:derived", changed_at: conversation.updated_at };
}

/** Whether a person (or a pending handoff) has the chat: the agent may not start a turn there. */
export function agentPaused(conversation: Pick<Conversation, "control" | "automation_paused" | "metadata" | "updated_at">): boolean {
  return controlOf(conversation).state !== "BOT";
}

/** The legacy fields for a state: what every reader of `automation_paused` / `mode` sees. */
export function legacyFields(state: ConversationControlState): Pick<Conversation, "automation_paused" | "mode"> {
  return { automation_paused: state !== "BOT", mode: state === "BOT" ? "AI" : "HUMAN" };
}
