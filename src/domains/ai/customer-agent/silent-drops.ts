/**
 * Silent-drop detector (messaging reliability MR1, FX-100). A customer message older than the grace period with no
 * later outbound is either waiting for a person (the chat is paused: the inbox shows it) or a silent drop (the agent
 * should have answered it and nothing did). Silent drops are what the monitoring job alerts on.
 */
import { readTenantRows } from "@/infrastructure/db/tenant-rows";
import type { TenantRecord } from "@/infrastructure/db";
import type { Conversation, ConversationStatus } from "@/types/social";
import { agentMode, channelAllowed } from "./jobs";
import { agentPaused } from "@/domains/social/conversations/conversation-control.state";

export const SILENT_DROP_GRACE_MS = 5 * 60_000;
/** Older messages are someone else's backlog, not a live failure. */
export const SILENT_DROP_WINDOW_MS = 24 * 60 * 60_000;
const CLOSED: ReadonlySet<ConversationStatus> = new Set<ConversationStatus>(["RESOLVED", "CLOSED", "SPAM"]);

export interface SilentDropReport {
  silent: number;
  awaiting_human: number;
  tenants: Array<{ tenant_id: string; silent: number; awaiting_human: number }>;
}

export async function findSilentDrops(tenants: readonly TenantRecord[], now = Date.now()): Promise<SilentDropReport> {
  const before = new Date(now - SILENT_DROP_GRACE_MS).toISOString();
  const after = new Date(now - SILENT_DROP_WINDOW_MS).toISOString();
  const report: SilentDropReport = { silent: 0, awaiting_human: 0, tenants: [] };
  for (const tenant of tenants) {
    const autonomous = agentMode(tenant.id) === "AUTONOMOUS";
    let silent = 0;
    let awaiting = 0;
    for (const c of await readTenantRows<Conversation>("conversations", tenant.id)) {
      const inbound = c.last_inbound_at;
      if (!inbound || inbound > before || inbound < after || CLOSED.has(c.status)) continue;
      if (c.last_outbound_at && c.last_outbound_at >= inbound) continue;
      if (agentPaused(c)) awaiting++;
      else if (autonomous && channelAllowed(tenant.id, c.channel_type, c.channel_id)) silent++;
    }
    if (silent || awaiting) report.tenants.push({ tenant_id: tenant.id, silent, awaiting_human: awaiting });
    report.silent += silent;
    report.awaiting_human += awaiting;
  }
  return report;
}
