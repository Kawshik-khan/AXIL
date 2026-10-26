/**
 * Customer-agent jobs (ADR-112, FX-76): an inbound message enqueues a turn; the worker runs it outside the store lock.
 *
 * Autonomous replies are off unless the platform flag `customer_agent_autonomous` exists and is on for the workspace
 * (a missing flag means OFF here, unlike most flags). `customer_agent_shadow` runs the turn and stores the draft
 * without sending. The workspace's own AI policy has the last word: DISABLED (or AI off) means OFF, COPILOT at most SHADOW.
 */
import { db } from "@/infrastructure/db";
import { isFeatureEnabled } from "@/lib/safety-gate";
import { logger } from "@/lib/logger";
import { agentPaused } from "@/domains/social/conversations/conversation-control.state";
import type { ChannelType, Conversation } from "@/types/social";

export const AUTONOMOUS_FLAG = "customer_agent_autonomous";
export const SHADOW_FLAG = "customer_agent_shadow";
/** ADR-121 S2, per workspace: the agent's lease decides its sends, and new chats start with the agent (BOT). */
export const CONTROL_V2_FLAG = "conversation_control_v2";
const DEBOUNCE_MS = 2_000;
/** Channels the agent can't reply on yet: a turn there would cost model calls for a reply nobody receives. */
const NO_REPLY_CHANNELS: ReadonlySet<ChannelType> = new Set<ChannelType>(["WEBSITE_CHAT"]);

/** On only when the flag exists and is on for this workspace. */
export function strictFlag(key: string, tenantId: string): boolean {
  return Boolean(db.findPlatformFeatureFlag(key)) && isFeatureEnabled(key, tenantId);
}

/**
 * Makes sure the worker is running and takes this turn right after its debounce, so a reply doesn't wait for the next
 * interval (and works where the boot hook didn't start the worker). Suites drive `runAgentJobsOnce` themselves.
 */
function kickWorker(): void {
  if (process.env.NODE_ENV === "test") return;
  void import("./worker").then((m) => {
    // Outside the request's zero-hydration scope: the worker's timers must not inherit (and keep alive) its rows
    db.outsideTenantReads(() => {
      m.startCustomerAgentWorker();
      setTimeout(() => {
        // Logged like the timer's pass: this kick is usually the pass that runs the turn
        void m.runAgentJobsOnce()
          .then((s) => {
            if (s.claimed) logger.info("customer_agent.worker_pass", { ...s, trigger: "kick" });
          })
          .catch((err: unknown) => logger.warn("customer_agent.worker_failed", { trigger: "kick", error: (err as Error).message }));
      }, DEBOUNCE_MS + 200);
    });
  }).catch(() => undefined);
}

/** Whether the agent may answer on this channel: it can deliver there, and the workspace's AI policy allows it. */
export function channelAllowed(tenantId: string, channelType: ChannelType, channelId?: string): boolean {
  if (channelType === "WEBSITE_CHAT") {
    const channel = channelId
      ? db.findConnectedChannelById(tenantId, channelId)
      : db.getConnectedChannels(tenantId).find((c) => c.type === "WEBSITE_CHAT" && c.status === "ACTIVE");
    const isLiveStorefront = channel?.id === "chn_web_chat" || (channel?.configuration?.auto_reply_enabled === true && channel?.provider_account_id === "web_chat_dhaka_01");
    return Boolean(isLiveStorefront) && db.getAIPolicy(tenantId).allowed_channel_types.includes(channelType);
  }
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
  if (!channelAllowed(conversation.tenant_id, conversation.channel_type, conversation.channel_id)) return;
  if (agentMode(conversation.tenant_id) === "OFF") return;
  // A handoff or a staff reply pauses automation: from then on a person answers this chat
  if (agentPaused(conversation)) {
    logger.info("customer_agent.not_queued", { reason: "automation_paused", tenant_id: conversation.tenant_id, conversation_id: conversation.id });
    // The message now waits for a person: the inbox shows how many, and a resume answers them (MR2)
    db.updateConversation(conversation.tenant_id, conversation.id, {
      awaiting_since: conversation.awaiting_since ?? new Date().toISOString(),
      awaiting_count: (conversation.awaiting_count ?? 0) + 1,
    });
    return;
  }
  const now = new Date();
  const notBefore = new Date(now.getTime() + DEBOUNCE_MS).toISOString();
  const existing = db.findAgentJob(conversation.tenant_id, conversation.id);
  if (existing?.status === "RUNNING") {
    db.saveAgentJob({ ...existing, rerun: true, last_message_id: messageId });
    kickWorker();
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
  kickWorker();
}

