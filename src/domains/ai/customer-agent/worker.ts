/**
 * Runs customer-agent jobs (ADR-112, FX-76) every second in each app server. A job is claimed in a short unit of work;
 * the model turn runs outside the store lock (its writes are background writes, committed by the store's loop), and the
 * reply goes out through the normal outbound path, so the kill switches, channel policy and rate limits all apply.
 * Several servers are safe: the claim is a version-checked write, and the send is idempotent per job and message.
 * Each pass takes at most one job per workspace, so one busy (or abusive) workspace can't starve the others.
 * The same loop delivers the domain-event outbox (FX-99 Part B) and checks agent-health alerts (FX-81).
 * `CUSTOMER_AGENT_WORKER=0` turns all of it off on a server.
 */
import { db } from "@/infrastructure/db";
import { logger } from "@/lib/logger";
import { AppError, KillSwitchActiveError } from "@/lib/errors";
import { assertNotKilled } from "@/lib/safety-gate";
import type { AgentJob } from "@/types/ai";
import { OutboundMessageService } from "@/domains/social/outbound/outbound-message.service";
import { AgentPolicyService } from "@/domains/ai/policy/agent-policy.service";
import { AgentHealthService } from "@/domains/platform/services/agent-health.service";
import { dispatchOutboxOnce } from "@/domains/automation/outbox/dispatcher";
import { capabilityContext, principalFor } from "./principal";
import { runCustomerTool } from "./tools";
import { customerMessages } from "./confirmation";
import { runCustomerTurn } from "./runtime";
import { agentMode, channelAllowed } from "./jobs";
import { chatMessages } from "./runtime";
import { replyScript } from "./output";
import { hourWithin, localHour } from "@/lib/local-time";
import { quoteShownIn } from "./output";

const INTERVAL_MS = 1_000;
/** A claim older than this belongs to a server that died mid-turn; the job is taken again (a turn takes under a minute). */
const STALE_CLAIM_MS = 5 * 60_000;
const MAX_ATTEMPTS = 2;
/** More turns than this in the window means a loop or abuse: a person takes the chat. */
const ABUSE_RUNS = 20;
const ABUSE_WINDOW_MS = 10 * 60_000;
/** Turns per workspace per hour; beyond it jobs wait (rotating visitor ids can't buy unlimited model calls). */
const TENANT_RUNS_PER_HOUR = 300;
const RERUN_DELAY_MS = 2_000;
const DEFER_MS = 60_000;
/** Jobs looked at per pass, and turns run per pass (one per workspace). */
const SCAN_LIMIT = 200;
const TURNS_PER_PASS = 5;
const DELIVERED = new Set(["SENT", "QUEUED", "DELIVERED", "READ"]);
/** Health alerts (FX-81) are checked once a minute per server; incidents are deduplicated by title. */
const ALERT_INTERVAL_MS = 60_000;
let lastAlertCheck = 0;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

type Finish = Pick<AgentJob, "status" | "outcome"> & { notBefore?: string };

async function claim(job: AgentJob): Promise<AgentJob | undefined> {
  const now = new Date();
  return db.unit(async () => {
    const current = db.findAgentJob(job.tenant_id, job.conversation_id);
    if (!current || current.id !== job.id) return undefined;
    const due = current.status === "PENDING" && current.not_before <= now.toISOString();
    const stale = current.status === "RUNNING" && (current.claimed_at ?? "") < new Date(now.getTime() - STALE_CLAIM_MS).toISOString();
    if (!due && !stale) return undefined;
    return db.saveAgentJob({ ...current, status: "RUNNING", claimed_at: now.toISOString(), attempts: current.attempts + 1, rerun: false });
  }, (r) => Boolean(r));
}

async function finish(job: AgentJob, result: Finish): Promise<void> {
  await db.unit(async () => {
    const current = db.findAgentJob(job.tenant_id, job.conversation_id) ?? job;
    if (result.notBefore) {
      // Deferred (workspace limit, or a retry): keep whatever arrived meanwhile
      // A retry keeps its attempt count; a deferral (workspace limit) isn't a failure and doesn't use one up
      db.saveAgentJob({
        ...current, status: "PENDING", claimed_at: undefined, outcome: result.outcome, not_before: result.notBefore,
        attempts: result.outcome === "RETRY" ? current.attempts : 0,
      });
    } else if (current.rerun && result.status === "DONE") {
      // A message arrived during the turn: one more turn, from the start, for what the customer said since
      db.saveAgentJob({
        ...current, status: "PENDING", rerun: false, attempts: 0, claimed_at: undefined, outcome: result.outcome,
        not_before: new Date(Date.now() + RERUN_DELAY_MS).toISOString(),
      });
    } else {
      db.saveAgentJob({ ...current, status: result.status, outcome: result.outcome, rerun: false });
    }
    return true;
  }, () => true);
}

/** Pass the chat to the team (outside any unit: the handoff tool commits its own changes). */
async function handOff(job: AgentJob, summary: string): Promise<void> {
  const pr = principalFor(job.tenant_id, job.conversation_id);
  if (!pr) return;
  await runCustomerTool(pr, "handoff_to_human", { reason: "other", summary });
}

const turnsSince = (tenantId: string, sinceIso: string, conversationId?: string) =>
  db.countAgentRunsSince(tenantId, "CUSTOMER_AGENT", sinceIso, conversationId);

/**
 * Quotes this turn created or summarised were delivered by `messageId`: only now can a later "yes" confirm them, and
 * only a yes after this point (ADR-112; a shadow draft or a failed send never makes a quote confirmable).
 */
async function markQuotesShown(job: AgentJob, turnStartedAt: string, messageId: string, text: string): Promise<void> {
  await db.unit(async () => {
    const count = customerMessages(job.tenant_id, job.conversation_id).length;
    for (const q of db.getConversationQuotes(job.tenant_id, job.conversation_id)) {
      // Only a reply that still shows the total after the output guards counts (a replaced reply showed nothing)
      if (q.status === "QUOTED" && q.updated_at >= turnStartedAt && quoteShownIn(text, q.grand_total)) {
        db.updateQuote(job.tenant_id, q.id, { shown_message_id: messageId, customer_msg_count_at_quote: count });
      }
    }
    return true;
  }, () => true);
}

/** The shop's agent hours (settings.customer_agent_hours, shop-local 0–24), or none: always on. */
export function agentHours(tenantId: string): { start_hour: number; end_hour: number } | undefined {
  const raw = (db.findTenantById(tenantId)?.settings as Record<string, unknown> | undefined)?.customer_agent_hours as { start_hour?: unknown; end_hour?: unknown } | undefined;
  const ok = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 24;
  return raw && ok(raw.start_hour) && ok(raw.end_hour) && raw.start_hour !== raw.end_hour ? { start_hour: raw.start_hour as number, end_hour: raw.end_hour as number } : undefined;
}

const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;

/** Hands the chat to the team and tells the customer when someone will answer (no model call). */
async function outsideHours(job: AgentJob, pr: NonNullable<ReturnType<typeof principalFor>>, hours: { start_hour: number; end_hour: number }): Promise<Finish> {
  const last = [...chatMessages(job.tenant_id, job.conversation_id, 5)].reverse().find((m) => m.sender_type === "CUSTOMER");
  const handed = await runCustomerTool(pr, "handoff_to_human", { reason: "other", summary: `Message outside the agent's hours (${hh(hours.start_hour)}–${hh(hours.end_hour)}); please answer when the team is on.` });
  const text =
    replyScript(last?.text ?? "") === "bangla"
      ? `ধন্যবাদ! আমাদের টিম ${hh(hours.start_hour)} থেকে ${hh(hours.end_hour)} পর্যন্ত উত্তর দেয়। টিমের একজন এখানে আপনাকে উত্তর দেবেন।`
      : `Dhonnobad! Amader team ${hh(hours.start_hour)} theke ${hh(hours.end_hour)} porjonto reply dey. Team er ekjon ekhane apnake reply dibe.`;
  // "A team member will reply" is only said when a team member really has the chat
  if (!handed.ok) return { status: "BLOCKED", outcome: "OUTSIDE_HOURS_HANDOFF_FAILED" };
  try {
    await OutboundMessageService.sendMessage(capabilityContext(pr, "send"), job.conversation_id, { text, idempotency_key: `agent:${job.id}:${last?.id ?? job.last_message_id}:hours` }, { asAgent: true, agentHandedOff: true, traceId: job.id });
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    return { status: "BLOCKED", outcome: `OUTSIDE_HOURS_SEND_REFUSED:${err.code}` };
  }
  return { status: "DONE", outcome: "OUTSIDE_HOURS" };
}

/** Runs one claimed job to its end. Exported for tests. */
export async function runAgentJob(job: AgentJob): Promise<Finish> {
  const pr = principalFor(job.tenant_id, job.conversation_id);
  if (!pr) return { status: "BLOCKED", outcome: "INACTIVE_WORKSPACE_OR_CHANNEL" };
  const conversation = db.findConversationById(job.tenant_id, job.conversation_id);
  const mode = agentMode(job.tenant_id);
  if (!conversation || conversation.automation_paused || mode === "OFF" || !channelAllowed(job.tenant_id, pr.channelType)) {
    return { status: "CANCELLED", outcome: "NOT_ELIGIBLE" };
  }

  // A paused workspace or channel: no model call at all, in shadow mode too
  try {
    assertNotKilled(job.tenant_id, "CHANNEL", pr.channelId, pr.channelType);
  } catch (err) {
    if (err instanceof KillSwitchActiveError) return { status: "BLOCKED", outcome: "KILL_SWITCH" };
    throw err;
  }

  const now = Date.now();
  const chatTurns = turnsSince(job.tenant_id, new Date(now - ABUSE_WINDOW_MS).toISOString(), job.conversation_id);
  if (chatTurns >= ABUSE_RUNS) {
    if (mode === "AUTONOMOUS") await handOff(job, `Automatic replies stopped: ${chatTurns} turns in 10 minutes.`);
    return { status: "BLOCKED", outcome: "RUN_LIMIT" };
  }
  if (turnsSince(job.tenant_id, new Date(now - 60 * 60_000).toISOString()) >= TENANT_RUNS_PER_HOUR) {
    return { status: "PENDING", outcome: "TENANT_RATE_LIMIT", notBefore: new Date(now + DEFER_MS).toISOString() };
  }
  // Pilot hours (FX-87): outside the shop's agent hours a person takes the chat, and the customer is told when
  if (mode === "AUTONOMOUS") {
    const hours = agentHours(job.tenant_id);
    const tenant = db.findTenantById(job.tenant_id);
    if (hours && tenant && !hourWithin(localHour(tenant, Date.now()), hours.start_hour, hours.end_hour)) {
      return outsideHours(job, pr, hours);
    }
  }

  const budget = AgentPolicyService.checkBudget(job.tenant_id);
  if (!budget.withinBudget) {
    if (mode === "AUTONOMOUS") await handOff(job, "Automatic replies paused: the workspace's daily AI budget is used up.");
    return { status: "BLOCKED", outcome: "BUDGET" };
  }

  const shadow = mode === "SHADOW";
  const turnStartedAt = new Date().toISOString();
  const turn = await runCustomerTurn(pr, { shadow, traceId: job.id });
  if (!turn.reply) return { status: "DONE", outcome: turn.status };

  if (shadow) {
    await db.unit(async () => {
      const convo = db.findConversationById(job.tenant_id, job.conversation_id);
      if (convo) {
        db.updateConversation(job.tenant_id, convo.id, {
          metadata: {
            ...convo.metadata,
            agent_shadow_reply: { text: turn.reply, run_id: turn.runId, message_id: turn.answeredMessageId, status: turn.status, at: new Date().toISOString() },
          },
        });
      }
      return true;
    }, () => true);
    return { status: "DONE", outcome: `SHADOW_${turn.status}` };
  }

  try {
    const sent = await OutboundMessageService.sendMessage(
      capabilityContext(pr, "send"),
      job.conversation_id,
      // Keyed on the message this turn answered, so a message that arrived after the claim gets one reply, not two
      { text: turn.reply, idempotency_key: `agent:${job.id}:${turn.answeredMessageId ?? job.last_message_id}` },
      { asAgent: true, agentTurnStartedAt: turnStartedAt, agentHandedOff: turn.handoff, traceId: job.id }
    );
    if (DELIVERED.has(sent.status)) await markQuotesShown(job, turnStartedAt, sent.id, turn.reply);
    return { status: "DONE", outcome: `${turn.status}:${sent.status}` };
  } catch (err) {
    if (err instanceof AppError && err.code === "AGENT_SUPERSEDED") return { status: "CANCELLED", outcome: "STAFF_REPLIED" };
    // A kill switch, a disabled feature or channel policy: sending again won't help, and a person should look
    if (err instanceof KillSwitchActiveError || (err instanceof AppError && err.statusCode < 500 && err.statusCode !== 409)) {
      logger.warn("customer_agent.send_refused", { tenant_id: job.tenant_id, conversation_id: job.conversation_id, code: err.code });
      return { status: "BLOCKED", outcome: `SEND_REFUSED:${err.code}` };
    }
    throw err;
  }
}

/** One pass: at most one job per workspace, oldest first, claimed one at a time. Exported for tests. */
export async function runAgentJobsOnce(limit = TURNS_PER_PASS): Promise<{ claimed: number; done: number; failed: number }> {
  const now = Date.now();
  const due = db.getDueAgentJobs(new Date(now).toISOString(), new Date(now - STALE_CLAIM_MS).toISOString(), SCAN_LIMIT);
  const seenTenants = new Set<string>();
  const picked = due
    .filter((j) => {
      if (seenTenants.has(j.tenant_id)) return false;
      seenTenants.add(j.tenant_id);
      return true;
    })
    .slice(0, limit);
  const stats = { claimed: 0, done: 0, failed: 0 };
  for (const candidate of picked) {
    const job = await claim(candidate).catch(() => undefined); // another server took it, or a store conflict
    if (!job) continue;
    stats.claimed++;
    try {
      const result = await runAgentJob(job);
      await finish(job, result);
      if (result.status === "DONE") stats.done++;
    } catch (err) {
      stats.failed++;
      logger.warn("customer_agent.job_failed", { tenant_id: job.tenant_id, conversation_id: job.conversation_id, attempt: job.attempts, error: (err as Error).name });
      if (job.attempts >= MAX_ATTEMPTS) {
        await handOff(job, "Automatic reply failed; please answer this customer.").catch(() => undefined);
        await finish(job, { status: "FAILED", outcome: "ERROR" }).catch(() => undefined);
      } else {
        await finish(job, { status: "PENDING", outcome: "RETRY", notBefore: new Date(Date.now() + RERUN_DELAY_MS).toISOString() }).catch(() => undefined);
      }
    }
  }
  return stats;
}

export function startCustomerAgentWorker(): void {
  if (timer || process.env.CUSTOMER_AGENT_WORKER === "0" || process.env.NEXT_PHASE === "phase-production-build") return;
  timer = setInterval(() => {
    if (running) return; // a turn takes seconds: never overlap passes
    running = true;
    runAgentJobsOnce()
      .then(async (s) => {
        if (s.claimed) logger.info("customer_agent.worker_pass", s);
        // Domain-event outbox (FX-99 Part B): same worker, same never-overlap rule
        const o = await dispatchOutboxOnce();
        if (o.delivered || o.failed || o.dead) logger.info("outbox.dispatch_pass", o);
        if (Date.now() - lastAlertCheck >= ALERT_INTERVAL_MS) {
          lastAlertCheck = Date.now();
          await db.unit(async () => AgentHealthService.raiseAlerts(), () => true);
        }
      })
      .catch((err: unknown) => logger.warn("customer_agent.worker_failed", { error: (err as Error).message }))
      .finally(() => {
        running = false;
      });
  }, INTERVAL_MS);
  timer.unref();
}

export function stopCustomerAgentWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
