/**
 * Conversation control (ADR-121, messaging reliability MR4): who answers a chat, the agent or a person.
 *
 * `transition` is the only code that changes it. It keeps the legacy fields (`automation_paused`, `mode`) derived from
 * the state for the readers that still use them, audits every real change with its actor and reason, and makes every
 * return to the agent answer what waited (MR2), whichever path resumed it.
 *
 * Synchronous on purpose: callers run inside their own unit of work (a request, the worker's turn, a job).
 */
import { db } from "@/infrastructure/db";
import { randomSuffix } from "@/lib/ids";
import { CONTROL_V2_FLAG, enqueueCustomerTurn, strictFlag } from "@/domains/ai/customer-agent/jobs";
import type { Conversation, ConversationControl, ConversationControlState } from "@/types/social";

/** Customer messages older than this aren't answered by a resume: someone else's backlog, not a live question. */
const CATCH_UP_WINDOW_MS = 24 * 60 * 60_000;

/** Allowed moves. A person already holding the chat isn't "escalated" by the agent: HUMAN→ESCALATED stays HUMAN. */
const ALLOWED: Record<ConversationControlState, readonly ConversationControlState[]> = {
  BOT: ["ESCALATED", "HUMAN"],
  ESCALATED: ["HUMAN", "BOT"],
  HUMAN: ["BOT"],
};

/** `platform:` is a CommerceOS operator (support takeover): audited as such, never recorded as the chat's owner. */
export type ControlActor = `user:${string}` | `platform:${string}` | `turn:${string}` | `system:${string}`;

/** The chat's control, derived for rows written before ADR-121 (never written on read). */
export function controlOf(conversation: Conversation): ConversationControl {
  if (conversation.control) return conversation.control;
  const state: ConversationControlState = !conversation.automation_paused
    ? "BOT"
    : conversation.metadata?.handoff_card
      ? "ESCALATED"
      : "HUMAN";
  return { state, version: 0, reason: "derived", changed_by: "system:derived", changed_at: conversation.updated_at };
}

/** The legacy fields for a state: what every reader of `automation_paused` / `mode` sees. */
export function legacyFields(state: ConversationControlState): Pick<Conversation, "automation_paused" | "mode"> {
  return { automation_paused: state !== "BOT", mode: state === "BOT" ? "AI" : "HUMAN" };
}

/**
 * Fields of a conversation being created. With `conversation_control_v2` the chat starts as the agent's (BOT, `mode: AI`)
 * with an explicit control; without it, as before ADR-121 (`mode: HUMAN`, not paused, which old readers took as paused).
 */
export function initialControlFields(tenantId: string): Pick<Conversation, "automation_paused" | "mode" | "control"> {
  if (!strictFlag(CONTROL_V2_FLAG, tenantId)) return { automation_paused: false, mode: "HUMAN" };
  return {
    ...legacyFields("BOT"),
    control: { state: "BOT", version: 0, reason: "created", changed_by: "system:ingress", changed_at: new Date().toISOString() },
  };
}

export interface TransitionResult {
  conversation: Conversation;
  changed: boolean;
  from: ConversationControlState;
}

export class ConversationControlService {
  /**
   * Moves the chat to `to`. Same state, or a move the table doesn't allow, changes nothing (no version bump, no audit).
   * `actor` comes from the session (`user:`), the agent worker (`turn:`) or a job (`system:`), never from a request body.
   */
  public static transition(
    tenantId: string,
    conversationId: string,
    to: ConversationControlState,
    actor: ControlActor,
    reason: string,
    opts: { ownerUserId?: string } = {}
  ): TransitionResult {
    const current = db.findConversationById(tenantId, conversationId);
    if (!current) throw new Error(`Conversation '${conversationId}' not found for tenant '${tenantId}'`);
    const before = controlOf(current);
    if (before.state === to || !ALLOWED[before.state].includes(to)) {
      return { conversation: current, changed: false, from: before.state };
    }

    const now = new Date().toISOString();
    const control: ConversationControl = {
      state: to,
      version: before.version + 1,
      ...(to === "HUMAN" && opts.ownerUserId && actor.startsWith("user:") ? { owner_user_id: opts.ownerUserId } : {}),
      reason,
      changed_by: actor,
      changed_at: now,
    };
    const updated = db.updateConversation(tenantId, conversationId, {
      control,
      ...legacyFields(to),
      // Back to the agent: what waited is its to answer now (below); nothing waits for a person any more
      ...(to === "BOT" ? { awaiting_since: undefined, awaiting_count: 0 } : {}),
    });
    db.createAuditLog({
      id: `aud_${Date.now()}_conversation_control_${randomSuffix()}`,
      tenant_id: tenantId,
      actor_user_id: actor.startsWith("user:") ? actor.slice("user:".length) : actor,
      action: "CONVERSATION_CONTROL",
      resource_type: "conversation",
      resource_id: conversationId,
      metadata: { from: before.state, to, reason, version: control.version, changed_by: actor, actor_type: actor.slice(0, actor.indexOf(":")) },
      created_at: now,
    });
    if (to === "BOT") this.catchUp(updated);
    return { conversation: updated, changed: true, from: before.state };
  }

  /**
   * One turn for the latest customer message when nothing was sent after it and it is under a day old (MR2).
   * Newest first, in stored order: timestamps can tie (same millisecond), the order of the messages can't.
   */
  private static catchUp(conversation: Conversation): void {
    for (const m of [...db.getMessages(conversation.tenant_id, conversation.id, { limit: 50 }).messages].reverse()) {
      if (m.direction === "OUTBOUND" && m.message_type !== "INTERNAL_NOTE") return; // answered after it
      if (m.direction !== "INBOUND" || m.sender_type !== "CUSTOMER") continue;
      if (Date.now() - Date.parse(m.created_at) > CATCH_UP_WINDOW_MS) return;
      enqueueCustomerTurn(conversation, m.id);
      return;
    }
  }
}
