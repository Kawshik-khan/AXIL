/**
 * Customer-agent jobs (ADR-112, FX-76): an inbound message enqueues a turn; the worker runs it outside the store lock.
 *
 * Autonomous replies are off unless the platform flag `customer_agent_autonomous` exists and is on for the workspace
 * (a missing flag means OFF here, unlike most flags). `customer_agent_shadow` runs the turn and stores the draft
 * without sending. The workspace's own AI policy has the last word: DISABLED (or AI off) means OFF, COPILOT at most SHADOW.
 */
import { db } from "@/infrastructure/db";
import { isFeatureEnabled } from "@/lib/safety-gate";
import type { ChannelType, Conversation } from "@/types/social";

export const AUTONOMOUS_FLAG = "customer_agent_autonomous";
export const SHADOW_FLAG = "customer_agent_shadow";
const DEBOUNCE_MS = 2_000;
/** Channels the agent can't reply on yet: a turn there would cost model calls for a reply nobody receives. */
const NO_REPLY_CHANNELS: ReadonlySet<ChannelType> = new Set<ChannelType>(["WEBSITE_CHAT"]);

/** On only when the flag exists and is on for this workspace. */
export function strictFlag(key: string, tenantId: string): boolean {
  return Boolean(db.findPlatformFeatureFlag(key)) && isFeatureEnabled(key, tenantId);
}

/** Whether the agent may answer on this channel: it can deliver there, and the workspace's AI policy allows it. */
export function channelAllowed(tenantId: string, channelType: ChannelType): boolean {
  return !NO_REPLY_CHANNELS.has(channelType) && db.getAIPolicy(tenantId).allowed_channel_types.includes(channelType);
}

export function agentMode(tenantId: string): "AUTONOMOUS" | "SHADOW" | "OFF" {
  const policy = db.getAIPolicy(tenantId);
  if (!policy.is_enabled || policy.ai_mode === "DISABLED") return "OFF";
  if (strictFlag(AUTONOMOUS_FLAG, tenantId) && policy.ai_mode === "AI_AUTONOMOUS") return "AUTONOMOUS";
  if (strictFlag(AUTONOMOUS_FLAG, tenantId) || strictFlag(SHADOW_FLAG, tenantId)) return "SHADOW";
  return "OFF";
}

/**
 * Called in the same unit of work that stored an inbound customer message. One open job per conversation: a newer
 * message moves its start (2-second debounce), and a message during a running turn asks for one more turn.
 */
export function enqueueCustomerTurn(conversation: Conversation, messageId: string): void {
  if (!channelAllowed(conversation.tenant_id, conversation.channel_type)) return;
  if (agentMode(conversation.tenant_id) === "OFF") return;
  // A handoff or a staff reply pauses automation: from then on a person answers this chat
  if (conversation.automation_paused) return;
  const now = new Date();
  const notBefore = new Date(now.getTime() + DEBOUNCE_MS).toISOString();
  const existing = db.findAgentJob(conversation.tenant_id, conversation.id);
  if (existing?.status === "RUNNING") {
    db.saveAgentJob({ ...existing, rerun: true, last_message_id: messageId });
    return;
  }
  db.saveAgentJob({
    id: existing?.id ?? `job_${conversation.id}`,
    tenant_id: conversation.tenant_id,
    conversation_id: conversation.id,
    status: "PENDING",
    not_before: notBefore,
    last_message_id: messageId,
    attempts: existing?.status === "PENDING" ? existing.attempts : 0,
    rerun: false,
    created_at: existing?.created_at ?? now.toISOString(),
    updated_at: now.toISOString(),
  });
}
