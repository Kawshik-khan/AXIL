/**
 * Customer-agent health for the super-admin view and its alerts (FX-81, audit F17). Everything is computed from the
 * recorded runs (`agent_runs.metadata.calls`, guards, handoff reasons) and tool calls; nothing is estimated. Reads
 * never write; alerts open a platform incident (deduplicated by title while it's open) from the background worker.
 */
import { db } from "@/infrastructure/db";
import { logger } from "@/lib/logger";
import type { AgentRun, AgentToolCallRecord } from "@/types/ai";
import type { PlatformContext } from "@/lib/context";
import { PlatformAuthorizationService } from "./platform-authorization.service";
import { embeddingMetrics } from "@/domains/ai/rag/embedding.service";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

interface CallTrace { throttled?: number; cached?: number; prompt?: number }
const metaOf = (r: AgentRun) => (r.metadata ?? {}) as { calls?: CallTrace[]; guards?: string[]; handoff_reason?: string; cached_tokens?: number };
const done = (r: AgentRun) => Boolean(r.completed_at);
const quantile = (xs: number[], q: number): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const share = (n: number, d: number): number | null => (d ? Math.round((n / d) * 1000) / 10 : null);
const handedOff = (r: AgentRun) => r.current_step === "HUMAN_HANDOFF" || Boolean(metaOf(r).handoff_reason);
const guardName = (g: string) => g.split(":")[0];

export interface AgentHealth {
  generated_at: string;
  window_hours: 24;
  turns: number;
  turns_per_hour: Array<{ hour: string; turns: number }>;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  cost_usd_last_24h: number;
  cost_usd_by_day: Array<{ day: string; cost_usd: number }>;
  cost_by_tenant: Array<{ tenant_id: string; tenant_name: string; turns: number; cost_usd: number }>;
  cache_hit_share: number | null;
  tool_calls: number;
  tool_failure_rate: number | null;
  guard_triggers: Record<string, number>;
  handoff_rate: number | null;
  escalation_reasons: Record<string, number>;
  model_calls: number;
  throttled_429: number;
  throttled_rate: number | null;
  /** This server's embedding calls since it started (FX-82); not across servers. */
  embeddings?: ReturnType<typeof embeddingMetrics>;
}

/** The numbers, from runs and tool calls given (pure, for the route, the alerts and tests). */
export function computeAgentHealth(runs: AgentRun[], toolCalls: AgentToolCallRecord[], now = Date.now()): AgentHealth {
  const since24 = new Date(now - DAY).toISOString();
  const last24 = runs.filter((r) => done(r) && r.started_at >= since24);
  const tenants = new Map(db.getTenants().map((t) => [t.id, t.name]));

  const turnsPerHour: AgentHealth["turns_per_hour"] = [];
  for (let h = 23; h >= 0; h--) {
    const from = new Date(now - (h + 1) * HOUR).toISOString();
    const to = new Date(now - h * HOUR).toISOString();
    turnsPerHour.push({ hour: from.slice(0, 13) + ":00Z", turns: last24.filter((r) => r.started_at >= from && r.started_at < to).length });
  }
  const byDay = new Map<string, number>();
  for (const r of runs.filter(done)) byDay.set(r.started_at.slice(0, 10), (byDay.get(r.started_at.slice(0, 10)) ?? 0) + r.estimated_cost_usd);
  const byTenant = new Map<string, { turns: number; cost: number }>();
  for (const r of last24) {
    const t = byTenant.get(r.tenant_id) ?? { turns: 0, cost: 0 };
    t.turns++;
    t.cost += r.estimated_cost_usd;
    byTenant.set(r.tenant_id, t);
  }
  const calls = last24.flatMap((r) => metaOf(r).calls ?? []);
  const prompt = last24.reduce((n, r) => n + r.input_tokens, 0);
  const cached = last24.reduce((n, r) => n + (metaOf(r).cached_tokens ?? 0), 0);
  const runIds = new Set(last24.map((r) => r.id));
  const tools = toolCalls.filter((c) => runIds.has(c.agent_run_id));
  const guards: Record<string, number> = {};
  for (const g of last24.flatMap((r) => metaOf(r).guards ?? [])) guards[guardName(g)] = (guards[guardName(g)] ?? 0) + 1;
  const reasons: Record<string, number> = {};
  for (const r of last24) {
    const reason = metaOf(r).handoff_reason;
    if (reason) reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  const throttled = calls.reduce((n, c) => n + (c.throttled ?? 0), 0);
  const round = (x: number) => Number(x.toFixed(6));

  return {
    generated_at: new Date(now).toISOString(),
    window_hours: 24,
    turns: last24.length,
    turns_per_hour: turnsPerHour,
    latency_p50_ms: quantile(last24.map((r) => r.latency_ms), 0.5),
    latency_p95_ms: quantile(last24.map((r) => r.latency_ms), 0.95),
    cost_usd_last_24h: round(last24.reduce((n, r) => n + r.estimated_cost_usd, 0)),
    cost_usd_by_day: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-8).map(([day, cost]) => ({ day, cost_usd: round(cost) })),
    cost_by_tenant: [...byTenant.entries()]
      .map(([id, t]) => ({ tenant_id: id, tenant_name: tenants.get(id) ?? id, turns: t.turns, cost_usd: round(t.cost) }))
      .sort((a, b) => b.cost_usd - a.cost_usd),
    cache_hit_share: share(cached, prompt),
    tool_calls: tools.length,
    tool_failure_rate: share(tools.filter((c) => c.status === "ERROR").length, tools.length),
    guard_triggers: guards,
    handoff_rate: share(last24.filter(handedOff).length, last24.length),
    escalation_reasons: reasons,
    model_calls: calls.length,
    throttled_429: throttled,
    throttled_rate: share(throttled, calls.length + throttled),
  };
}

function load(now: number): { runs: AgentRun[]; toolCalls: AgentToolCallRecord[] } {
  const runs = db.getAgentRunsSinceAllTenants("CUSTOMER_AGENT", new Date(now - 8 * DAY).toISOString());
  const recent = new Set(runs.filter((r) => r.started_at >= new Date(now - DAY).toISOString()).map((r) => r.id));
  return { runs, toolCalls: db.getAgentToolCallsForRunsAllTenants(recent) };
}

export class AgentHealthService {
  /** GET: the last 24 hours across every workspace (platform operators only). Reads only. */
  public static getHealth(context: PlatformContext, now = Date.now()): AgentHealth {
    PlatformAuthorizationService.assertCan(context, "platform.read");
    const { runs, toolCalls } = load(now);
    return { ...computeAgentHealth(runs, toolCalls, now), embeddings: embeddingMetrics() };
  }

  /** The alert conditions that hold now (FX-81). Pure over the store; `raiseAlerts` records them. */
  public static evaluateAlerts(now = Date.now()): Array<{ title: string; severity: "SEV2" | "SEV3"; detail: string }> {
    const { runs } = load(now);
    const finished = runs.filter(done);
    const within = (ms: number) => finished.filter((r) => r.started_at >= new Date(now - ms).toISOString());
    const alerts: Array<{ title: string; severity: "SEV2" | "SEV3"; detail: string }> = [];

    const last15 = within(15 * 60_000);
    const p95 = quantile(last15.map((r) => r.latency_ms), 0.95);
    if (last15.length >= 5 && p95 !== null && p95 > 12_000) {
      alerts.push({ title: "Customer agent: p95 latency above 12 s", severity: "SEV3", detail: `p95 ${p95} ms over ${last15.length} turns in 15 minutes` });
    }
    const lastHour = within(HOUR);
    const handoffs = lastHour.filter(handedOff).length;
    if (lastHour.length >= 20 && handoffs / lastHour.length > 0.05) {
      alerts.push({ title: "Customer agent: handoff rate above 5%", severity: "SEV3", detail: `${handoffs} of ${lastHour.length} turns in the last hour handed off` });
    }
    for (const guard of ["number_removed", "order_claim_blocked"]) {
      const hits = last15.filter((r) => (metaOf(r).guards ?? []).some((g) => guardName(g) === guard)).length;
      if (hits) alerts.push({ title: `Customer agent: ${guard} guard triggered`, severity: "SEV2", detail: `${hits} turn(s) in the last 15 minutes; review the runs` });
    }
    const hourCalls = lastHour.flatMap((r) => metaOf(r).calls ?? []);
    const throttled = hourCalls.reduce((n, c) => n + (c.throttled ?? 0), 0);
    if (hourCalls.length >= 50 && throttled / (hourCalls.length + throttled) > 0.02) {
      alerts.push({ title: "Customer agent: provider 429 rate above 2%", severity: "SEV3", detail: `${throttled} throttled answers for ${hourCalls.length} calls in the last hour` });
    }
    const today = new Date(now).toISOString().slice(0, 10);
    const costByDay = new Map<string, number>();
    for (const r of finished) costByDay.set(r.started_at.slice(0, 10), (costByDay.get(r.started_at.slice(0, 10)) ?? 0) + r.estimated_cost_usd);
    const previous: number[] = [];
    for (let d = 1; d <= 7; d++) previous.push(costByDay.get(new Date(now - d * DAY).toISOString().slice(0, 10)) ?? 0);
    const avg = previous.reduce((n, x) => n + x, 0) / 7;
    const todayCost = costByDay.get(today) ?? 0;
    if (avg > 0 && todayCost > 3 * avg) {
      alerts.push({ title: "Customer agent: daily cost above 3× the 7-day average", severity: "SEV3", detail: `today $${todayCost.toFixed(4)} vs average $${avg.toFixed(4)}` });
    }
    // Embedding failures on this server since it started (FX-82)
    const emb = embeddingMetrics();
    if (emb.calls >= 100 && emb.failures / emb.calls > 0.01) {
      alerts.push({ title: "Knowledge search: embedding failure rate above 1%", severity: "SEV3", detail: `${emb.failures} of ${emb.calls} embedding calls failed since ${emb.since}` });
    }
    return alerts;
  }

  /** Opens a platform incident per alert that has none open yet. Called by the worker in a unit of work. */
  public static raiseAlerts(now = Date.now()): number {
    const open = new Set(db.getPlatformIncidents().filter((i) => i.status !== "RESOLVED" && i.status !== "CLOSED").map((i) => i.title));
    let raised = 0;
    for (const a of this.evaluateAlerts(now)) {
      if (open.has(a.title)) continue;
      const at = new Date(now).toISOString();
      db.savePlatformIncident({
        id: `inc_agent_${now}_${raised}`, title: a.title, severity: a.severity, status: "OPEN", affected_components: ["customer-agent"],
        impact_summary: a.detail, started_at: at, owner: "system:agent-health", created_at: at, updated_at: at,
      });
      logger.error("customer_agent.alert", { title: a.title, detail: a.detail });
      raised++;
    }
    return raised;
  }
}
