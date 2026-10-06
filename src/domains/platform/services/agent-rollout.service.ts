/**
 * Customer-agent rollout numbers (FX-87): the go/no-go criteria for shadow → Telegram pilot → wider rollout, computed
 * from recorded runs, staff ratings of shadow drafts and handoff cards. Read-only; platform operators only. Criteria
 * that can't be measured here (wrong actions found in review, CSAT, the nightly eval) are listed as manual checks.
 */
import { db } from "@/infrastructure/db";
import type { AgentRun } from "@/types/ai";
import type { PlatformContext } from "@/lib/context";
import { PlatformAuthorizationService } from "./platform-authorization.service";

const DAY = 24 * 60 * 60_000;
/** Guards that mean the agent tried to state money or an order it had no basis for. */
const MONEY_GUARDS = new Set(["order_claim_blocked", "payment_claim_blocked", "amount_stripped"]);
const MIN_RATED_DRAFTS = 20;

const quantile = (xs: number[], q: number): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const meta = (r: AgentRun) => (r.metadata ?? {}) as { shadow?: boolean; shadow_rating?: string; guards?: string[] };

export interface RolloutReport {
  window_days: number;
  tenant_id: string | null;
  shadow: { drafts: number; rated: number; usable: number; usable_share: number | null };
  autonomous: { turns: number };
  money_guard_triggers: number;
  latency_p95_ms: number | null;
  handoffs: { count: number; answered: number; queue_age_p95_min: number | null; unanswered_oldest_min: number | null };
  go: {
    shadow_to_pilot: { ready: boolean; checks: Record<string, boolean> };
    pilot_hold: { ready: boolean; checks: Record<string, boolean> };
  };
  manual_checks: string[];
}

export function computeRollout(runs: AgentRun[], now = Date.now(), windowDays = 7, tenantId: string | null = null): RolloutReport {
  const since = new Date(now - windowDays * DAY).toISOString();
  const recent = runs.filter((r) => r.agent_type === "CUSTOMER_AGENT" && r.completed_at && r.started_at >= since && (!tenantId || r.tenant_id === tenantId));
  const shadow = recent.filter((r) => meta(r).shadow);
  const rated = shadow.filter((r) => meta(r).shadow_rating);
  const usable = rated.filter((r) => meta(r).shadow_rating === "USABLE").length;
  const moneyGuards = recent.reduce((n, r) => n + (meta(r).guards ?? []).filter((g) => MONEY_GUARDS.has(g.split(":")[0])).length, 0);
  const p95 = quantile(recent.map((r) => r.latency_ms), 0.95);

  const ages: number[] = [];
  let answered = 0;
  let oldestOpen: number | null = null;
  const handed = db.getHandedOffConversationsSinceAllTenants(since).filter((c) => !tenantId || c.tenant_id === tenantId);
  for (const c of handed) {
    const at = (c.metadata.handoff_card as { created_at: string }).created_at;
    const reply = db.firstStaffReplyAfter(c.tenant_id, c.id, at);
    if (reply) {
      answered++;
      ages.push((Date.parse(reply.created_at) - Date.parse(at)) / 60_000);
    } else {
      const open = (now - Date.parse(at)) / 60_000;
      ages.push(open); // still waiting counts with its age so far
      oldestOpen = Math.max(oldestOpen ?? 0, open);
    }
  }
  const queueP95 = quantile(ages, 0.95);
  const usableShare = rated.length ? Math.round((usable / rated.length) * 1000) / 10 : null;
  const round = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);

  const shadowChecks = {
    [`at least ${MIN_RATED_DRAFTS} drafts rated`]: rated.length >= MIN_RATED_DRAFTS,
    "≥ 85% of rated drafts usable": usableShare !== null && usableShare >= 85,
    "0 money-claim guard triggers": moneyGuards === 0,
    "p95 latency ≤ 8 s": p95 !== null && p95 <= 8_000,
  };
  const pilotChecks = {
    "0 money-claim guard triggers": moneyGuards === 0,
    "handoff queue age p95 ≤ 10 min": queueP95 === null || queueP95 <= 10,
    "p95 latency ≤ 8 s": p95 === null || p95 <= 8_000,
  };
  return {
    window_days: windowDays,
    tenant_id: tenantId,
    shadow: { drafts: shadow.length, rated: rated.length, usable, usable_share: usableShare },
    autonomous: { turns: recent.length - shadow.length },
    money_guard_triggers: moneyGuards,
    latency_p95_ms: p95,
    handoffs: { count: handed.length, answered, queue_age_p95_min: round(queueP95), unanswered_oldest_min: round(oldestOpen) },
    go: {
      shadow_to_pilot: { ready: Object.values(shadowChecks).every(Boolean), checks: shadowChecks },
      pilot_hold: { ready: Object.values(pilotChecks).every(Boolean), checks: pilotChecks },
    },
    manual_checks: [
      "0 wrong actions found in the daily review of pilot chats (orders, prices, other customers' data)",
      "CSAT not worse than human-only (the shop's own survey or review)",
      "nightly agent eval green (GitHub Actions: Agent evals)",
      "kill switches rehearsed on staging (docs/customer-agent-rollout.md)",
    ],
  };
}

export class AgentRolloutService {
  public static report(context: PlatformContext, options: { tenantId?: string; windowDays?: number } = {}, now = Date.now()): RolloutReport {
    PlatformAuthorizationService.assertCan(context, "platform.read");
    const windowDays = Math.min(30, Math.max(1, options.windowDays ?? 7));
    const runs = db.getAgentRunsSinceAllTenants("CUSTOMER_AGENT", new Date(now - windowDays * DAY).toISOString());
    return computeRollout(runs, now, windowDays, options.tenantId ?? null);
  }
}
