"use client";

import React, { useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { PLATFORM_PERMISSIONS } from "@/lib/permissions";
import type { AgentHealth } from "@/domains/platform/services/agent-health.service";
import type { RolloutReport } from "@/domains/platform/services/agent-rollout.service";
import { usePlatformResource } from "../../_lib/use-platform-resource";
import { usePlatformSession } from "../../_lib/platform-session";
import { PlatformApiError, platformRequest } from "../../_lib/platform-client";
import { formatCount, formatDateTime, formatPercent, formatRelative, humanize, isPresent, NO_DATA } from "../../_lib/format";
import { CONSOLE_ROOT } from "../../_lib/platform-module-access";
import { PageHeader } from "../../_components/PageHeader";
import { ResourceView } from "../../_components/ResourceView";
import { StatusPill } from "../../_components/StatusPill";
import { Tabs, useTab, type TabDef } from "../../_components/Tabs";
import { PrivilegedActionDialog } from "../../_components/PrivilegedActionDialog";
import styles from "../../super-admin.module.css";

type TabId = "health" | "budgets" | "hitl" | "traces" | "rollout" | "models";

interface BudgetRow {
  tenant_id: string;
  tenant_name: string;
  spend_usd: number;
  cap_usd: number;
  usage_pct: number;
  hard_cap_action: string;
  soft_cap_percent: number;
  hard_cap_percent: number;
  status: "NORMAL" | "WARNING" | "CAPPED";
  updated_at?: string;
}

interface Escalation {
  id: string;
  tenant_id: string;
  tenant_name: string;
  conversation_id: string;
  customer_phone_masked: string;
  priority: string;
  status: string;
  trigger_reason: string;
  sla_due_at: string;
  created_at: string;
  assigned_to_user_id?: string;
}

interface TraceRow {
  id: string;
  tenant_name: string;
  channel: string;
  customer_message_preview: string;
  agent_reply_preview: string;
  model_id: string;
  latency_ms: number;
  confidence_score: number;
  guardrails_triggered: string[];
  timestamp: string;
}

interface Radar {
  total_turns_24h: number;
  hallucinations_blocked_24h: number;
  prompt_injections_blocked_24h: number;
  active_hitl_escalations: number;
  avg_human_response_time_min: number | null;
  provider_latency_p95_ms: number | null;
  ai_mode: string;
  model_gateway_health: Array<{ name: string; tier: string; provider: string; status: string; p95_latency_ms: number | null; requests_24h: number }>;
}

function usd(n: number | null | undefined): string {
  return isPresent(n) ? `$${n.toFixed(2)}` : NO_DATA;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <BentoCard span={3}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={value === NO_DATA ? styles.kpiValueMuted : styles.kpiValue}>{value}</div>
      {sub && <div className={styles.kpiSub}>{sub}</div>}
    </BentoCard>
  );
}

export default function AiGovernancePage() {
  const { can } = usePlatformSession();
  const tabs: TabDef<TabId>[] = [
    { id: "health", label: "Fleet health" },
    { id: "budgets", label: "Budgets" },
    { id: "hitl", label: "Human handover" },
    { id: "traces", label: "Traces" },
    { id: "rollout", label: "Rollout" },
    { id: "models", label: "Models", visible: can(PLATFORM_PERMISSIONS.ANALYTICS_PLATFORM_READ) },
  ];
  const [tab, setTab] = useTab(tabs, "health");
  const [injectionsOnly, setInjectionsOnly] = useState(false);
  const [budgetTarget, setBudgetTarget] = useState<BudgetRow | null>(null);
  const [cap, setCap] = useState("");
  const [capAction, setCapAction] = useState("FALLBACK_TO_RULES");
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const health = usePlatformResource<AgentHealth>(tab === "health" ? "/api/v1/platform/ai/agent-health" : null, { isEmpty: (h) => h.turns === 0 });
  const budgets = usePlatformResource<{ budgets: BudgetRow[] }>(tab === "budgets" ? "/api/v1/platform/ai/budget" : null, { isEmpty: (b) => b.budgets.length === 0 });
  const hitl = usePlatformResource<{ escalations: Escalation[]; pending_count: number; claimed_count: number }>(tab === "hitl" ? "/api/v1/platform/ai/hitl/queue" : null, {
    isEmpty: (q) => q.escalations.length === 0,
  });
  const traces = usePlatformResource<{ traces: TraceRow[]; total_count: number; injections_count: number }>(
    tab === "traces" ? `/api/v1/platform/ai/traces?limit=100${injectionsOnly ? "&injectionsOnly=true" : ""}` : null,
    { isEmpty: (t) => t.traces.length === 0 }
  );
  const rollout = usePlatformResource<RolloutReport>(tab === "rollout" ? "/api/v1/platform/ai/agent-rollout" : null);
  const radar = usePlatformResource<Radar>(tab === "models" ? "/api/v1/platform/ai/observability/radar" : null);

  const [takeoverTarget, setTakeoverTarget] = useState<{ esc: Escalation; action: "CLAIM" | "RESOLVE" } | null>(null);
  const takeover = (esc: Escalation, action: "CLAIM" | "RESOLVE") => {
    setActionError(null);
    setTakeoverTarget({ esc, action });
  };

  const reload = () => {
    health.reload();
    budgets.reload();
    hitl.reload();
    traces.reload();
    rollout.reload();
    radar.reload();
  };

  return (
    <>
      <PageHeader
        title="AI Governance"
        description="The customer agent across every workspace: health, spend caps, human handover, traces and rollout readiness."
        actions={
          <Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={reload}>
            Refresh
          </Button>
        }
      />
      {notice && (
        <div className={`${styles.banner} ${styles.bannerInfo}`} role="status">
          <span>{notice}</span>
          <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>
            Dismiss
          </Button>
        </div>
      )}
      {actionError && (
        <div className={`${styles.banner} ${styles.bannerDanger}`} role="alert">
          <span>{actionError}</span>
        </div>
      )}
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "health" && (
        <ResourceView
          state={health.state}
          onRetry={health.reload}
          resource="agent health"
          emptyFigure="no-data"
          emptyTitle="No agent turns in the last 24 hours"
          emptyDescription="Numbers appear once the customer agent answers messages."
          renderReady={(h) => (
            <BentoGrid>
              <Tile label="Turns (24 h)" value={formatCount(h.turns)} sub={`${formatCount(h.model_calls)} model calls`} />
              <Tile label="Latency p95" value={isPresent(h.latency_p95_ms) ? `${formatCount(h.latency_p95_ms)} ms` : NO_DATA} sub={isPresent(h.latency_p50_ms) ? `p50 ${formatCount(h.latency_p50_ms)} ms` : undefined} />
              <Tile label="Cost (24 h)" value={usd(h.cost_usd_last_24h)} sub={isPresent(h.cache_hit_share) ? `${formatPercent(h.cache_hit_share, 0)} cache hits` : undefined} />
              <Tile label="Handoff rate" value={isPresent(h.handoff_rate) ? formatPercent(h.handoff_rate) : NO_DATA} sub={isPresent(h.throttled_rate) ? `${formatPercent(h.throttled_rate)} throttled (429)` : undefined} />
              <BentoCard span={6} title="Cost by tenant (24 h)">
                {h.cost_by_tenant.length === 0 ? (
                  <span className={styles.muted}>No spend recorded.</span>
                ) : (
                  <ul className={styles.list}>
                    {h.cost_by_tenant.map((t) => (
                      <li key={t.tenant_id} className={styles.listRow}>
                        <Link href={`${CONSOLE_ROOT}/tenants/${encodeURIComponent(t.tenant_id)}`}>{t.tenant_name}</Link>
                        <span className={styles.mono}>
                          {usd(t.cost_usd)} · {formatCount(t.turns)} turns
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </BentoCard>
              <BentoCard span={6} title="Guards and escalations (24 h)">
                <ul className={styles.list}>
                  {Object.entries(h.guard_triggers).map(([k, v]) => (
                    <li key={`g:${k}`} className={styles.listRow}>
                      <span>Guard: {humanize(k)}</span>
                      <span className={styles.mono}>{formatCount(v)}</span>
                    </li>
                  ))}
                  {Object.entries(h.escalation_reasons).map(([k, v]) => (
                    <li key={`e:${k}`} className={styles.listRow}>
                      <span>Handoff: {humanize(k)}</span>
                      <span className={styles.mono}>{formatCount(v)}</span>
                    </li>
                  ))}
                  {Object.keys(h.guard_triggers).length + Object.keys(h.escalation_reasons).length === 0 && <li className={styles.muted}>No guard triggers or handoffs.</li>}
                </ul>
                <span className={styles.hint}>
                  Tool calls {formatCount(h.tool_calls)}, failure rate {isPresent(h.tool_failure_rate) ? formatPercent(h.tool_failure_rate) : NO_DATA}. Generated{" "}
                  {formatDateTime(h.generated_at)}.
                </span>
              </BentoCard>
            </BentoGrid>
          )}
        />
      )}

      {tab === "budgets" && (
        <BentoCard span={12} title="Monthly AI spend caps" subtitle="Soft and hard caps are enforced by the AI budget guard">
          <ResourceView
            state={budgets.state}
            onRetry={budgets.reload}
            resource="AI budgets"
            emptyFigure="empty-list"
            emptyTitle="No workspaces"
            emptyDescription="Budgets appear per workspace."
            renderReady={({ budgets: rows }) => (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Workspace</th>
                      <th>Spend / cap</th>
                      <th>Usage</th>
                      <th>At hard cap</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((b) => (
                      <tr key={b.tenant_id}>
                        <td>
                          <Link href={`${CONSOLE_ROOT}/tenants/${encodeURIComponent(b.tenant_id)}`}>{b.tenant_name}</Link>
                        </td>
                        <td className={styles.mono}>
                          {usd(b.spend_usd)} / {usd(b.cap_usd)}
                        </td>
                        <td>
                          <span className={styles.progressTrack} aria-label={`${b.usage_pct}%`}>
                            <span
                              className={`${styles.progressFill} ${b.status === "CAPPED" ? styles.progressBad : b.status === "WARNING" ? styles.progressWarn : ""}`}
                              style={{ width: `${Math.min(100, b.usage_pct)}%` }}
                            />
                          </span>
                        </td>
                        <td>{humanize(b.hard_cap_action)}</td>
                        <td>
                          <StatusPill status={b.status} tone={b.status === "CAPPED" ? "bad" : b.status === "WARNING" ? "warn" : "ok"} />
                        </td>
                        <td>
                          {can(PLATFORM_PERMISSIONS.PLATFORM_MANAGE) && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setCap(String(b.cap_usd));
                                setCapAction(b.hard_cap_action);
                                setBudgetTarget(b);
                              }}
                            >
                              Change cap
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          />
        </BentoCard>
      )}

      {tab === "hitl" && (
        <BentoCard span={12} title="Human handover queue" subtitle="Conversations the AI handed to people, across workspaces">
          <ResourceView
            state={hitl.state}
            onRetry={hitl.reload}
            resource="the handover queue"
            emptyFigure="queue-empty"
            emptyTitle="Nothing waiting for a person"
            emptyDescription="Escalations appear here when the agent hands a conversation over."
            renderReady={(q) => (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Workspace</th>
                      <th>Customer</th>
                      <th>Why</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>SLA</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {q.escalations.map((e) => {
                      const overdue = e.status === "PENDING_REVIEW" && Date.parse(e.sla_due_at) < Date.now();
                      return (
                        <tr key={e.id}>
                          <td>{e.tenant_name}</td>
                          <td className={styles.mono}>{e.customer_phone_masked}</td>
                          <td>{e.trigger_reason}</td>
                          <td>{humanize(e.priority)}</td>
                          <td>
                            <StatusPill status={e.status} tone={e.status === "PENDING_REVIEW" ? (overdue ? "bad" : "warn") : undefined} />
                          </td>
                          <td>{e.status === "PENDING_REVIEW" ? (overdue ? `Overdue ${formatRelative(e.sla_due_at)}` : `Due ${formatDateTime(e.sla_due_at)}`) : "—"}</td>
                          <td>
                            {can(PLATFORM_PERMISSIONS.AI_HITL_MANAGE) && e.status === "PENDING_REVIEW" && (
                              <Button size="sm" variant="outline" onClick={() => takeover(e, "CLAIM")}>
                                Claim
                              </Button>
                            )}
                            {can(PLATFORM_PERMISSIONS.AI_HITL_MANAGE) && e.status === "CLAIMED" && (
                              <Button size="sm" variant="outline" onClick={() => takeover(e, "RESOLVE")}>
                                Resolve & resume AI
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          />
        </BentoCard>
      )}

      {tab === "traces" && (
        <BentoCard
          span={12}
          title="Agent traces"
          subtitle="Newest first; previews are sanitized by the agent runtime"
          action={
            <label className={styles.hint}>
              <input type="checkbox" checked={injectionsOnly} onChange={(e) => setInjectionsOnly(e.target.checked)} /> Prompt injections only
            </label>
          }
        >
          <ResourceView
            state={traces.state}
            onRetry={traces.reload}
            resource="agent traces"
            emptyFigure="log-empty"
            emptyTitle={injectionsOnly ? "No prompt injections detected" : "No traces yet"}
            emptyDescription="Each agent turn records a trace with model, latency, confidence and guard outcomes."
            renderReady={(t) => (
              <div className={styles.tableWrap}>
                <span className={styles.hint}>
                  Showing {formatCount(t.traces.length)} of {formatCount(t.total_count)} · {formatCount(t.injections_count)} injection attempts recorded
                </span>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Workspace</th>
                      <th>Customer → agent</th>
                      <th>Model</th>
                      <th className={styles.numeric}>Latency</th>
                      <th className={styles.numeric}>Confidence</th>
                      <th>Guards</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.traces.map((r) => (
                      <tr key={r.id}>
                        <td>{formatDateTime(r.timestamp)}</td>
                        <td>{r.tenant_name}</td>
                        <td>
                          <span className={styles.rowMain}>
                            <span>{r.customer_message_preview || "—"}</span>
                            <span className={styles.rowMeta}>{r.agent_reply_preview || "—"}</span>
                          </span>
                        </td>
                        <td className={styles.mono}>{r.model_id}</td>
                        <td className={styles.numeric}>{formatCount(r.latency_ms)} ms</td>
                        <td className={styles.numeric}>{formatCount(r.confidence_score)}</td>
                        <td>{r.guardrails_triggered.length ? r.guardrails_triggered.map(humanize).join(", ") : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          />
        </BentoCard>
      )}

      {tab === "rollout" && (
        <ResourceView
          state={rollout.state}
          onRetry={rollout.reload}
          resource="the rollout report"
          emptyFigure="releases-empty"
          emptyTitle="No rollout data"
          emptyDescription="The report fills as shadow drafts are rated and autonomous turns run."
          renderReady={(r) => (
            <BentoGrid>
              <Tile label="Shadow drafts rated usable" value={isPresent(r.shadow.usable_share) ? formatPercent(r.shadow.usable_share) : NO_DATA} sub={`${formatCount(r.shadow.rated)} of ${formatCount(r.shadow.drafts)} rated`} />
              <Tile label="Autonomous turns" value={formatCount(r.autonomous.turns)} sub={`Last ${r.window_days} days`} />
              <Tile label="Money guard triggers" value={formatCount(r.money_guard_triggers)} />
              <Tile label="Latency p95" value={isPresent(r.latency_p95_ms) ? `${formatCount(r.latency_p95_ms)} ms` : NO_DATA} />
              {(["shadow_to_pilot", "pilot_hold"] as const).map((gate) => (
                <BentoCard key={gate} span={6} title={gate === "shadow_to_pilot" ? "Shadow → pilot" : "Pilot hold"} action={<StatusPill status={r.go[gate].ready ? "APPROVED" : "PENDING"} label={r.go[gate].ready ? "Ready" : "Not ready"} />}>
                  <ul className={styles.list}>
                    {Object.entries(r.go[gate].checks).map(([check, ok]) => (
                      <li key={check} className={styles.listRow}>
                        <span>{humanize(check)}</span>
                        <StatusPill status={ok ? "SUCCESS" : "FAILED"} label={ok ? "Pass" : "Fail"} />
                      </li>
                    ))}
                  </ul>
                </BentoCard>
              ))}
              {r.manual_checks.length > 0 && (
                <BentoCard span={12} title="Checks a person must make">
                  <ul className={styles.list}>
                    {r.manual_checks.map((c) => (
                      <li key={c} className={styles.listRow}>
                        {c}
                      </li>
                    ))}
                  </ul>
                </BentoCard>
              )}
            </BentoGrid>
          )}
        />
      )}

      {tab === "models" && (
        <ResourceView
          state={radar.state}
          onRetry={radar.reload}
          resource="the AI radar"
          emptyFigure="no-data"
          emptyTitle="No radar data"
          emptyDescription="The radar reads traces and escalations."
          renderReady={(r) => (
            <BentoGrid>
              <Tile label="AI mode" value={humanize(r.ai_mode)} sub="From the model router configuration" />
              <Tile label="Turns (24 h)" value={formatCount(r.total_turns_24h)} />
              <Tile label="Injections blocked (24 h)" value={formatCount(r.prompt_injections_blocked_24h)} sub={`${formatCount(r.hallucinations_blocked_24h)} ungrounded claims blocked`} />
              <Tile label="Human response (avg)" value={isPresent(r.avg_human_response_time_min) ? `${r.avg_human_response_time_min} min` : NO_DATA} sub={`${formatCount(r.active_hitl_escalations)} open handovers`} />
              <BentoCard span={12} title="Configured models" subtitle="Requests and p95 measured from the last 24 hours of traces">
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Tier</th>
                        <th>Model</th>
                        <th>Provider</th>
                        <th className={styles.numeric}>Requests</th>
                        <th className={styles.numeric}>p95</th>
                        <th>Traffic</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.model_gateway_health.map((m) => (
                        <tr key={m.tier}>
                          <td>{humanize(m.tier)}</td>
                          <td className={styles.mono}>{m.name}</td>
                          <td>{m.provider}</td>
                          <td className={styles.numeric}>{formatCount(m.requests_24h)}</td>
                          <td className={styles.numeric}>{isPresent(m.p95_latency_ms) ? `${formatCount(m.p95_latency_ms)} ms` : "—"}</td>
                          <td>
                            <StatusPill status={m.status} tone={m.status === "ACTIVE" ? "ok" : "neutral"} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </BentoCard>
            </BentoGrid>
          )}
        />
      )}

      {takeoverTarget && (
        <PrivilegedActionDialog
          open
          onClose={() => setTakeoverTarget(null)}
          actionKey="ai.hitl.takeover"
          submitLabel={takeoverTarget.action === "CLAIM" ? "Claim" : "Resolve & resume AI"}
          target={{ type: "tenant", id: takeoverTarget.esc.tenant_id, label: `${takeoverTarget.esc.tenant_name} · ${takeoverTarget.esc.customer_phone_masked}` }}
          execute={async (a) =>
            (
              await platformRequest("/api/v1/platform/ai/hitl/takeover", {
                method: "POST",
                json: {
                  tenant_id: takeoverTarget.esc.tenant_id,
                  escalation_id: takeoverTarget.esc.id,
                  action: takeoverTarget.action,
                  reason: a.reason,
                  ...(takeoverTarget.action === "RESOLVE" ? { resolution_type: "BOT_RESUMED", resume_bot: true } : {}),
                },
              })
            ).data
          }
          onDone={() => {
            setNotice(takeoverTarget.action === "CLAIM" ? "Escalation claimed." : "Escalation resolved and the AI resumed.");
            hitl.reload();
          }}
        >
          <span className={styles.hint}>Why the AI handed over: {takeoverTarget.esc.trigger_reason}</span>
        </PrivilegedActionDialog>
      )}

      {budgetTarget && (
        <PrivilegedActionDialog
          open
          onClose={() => setBudgetTarget(null)}
          actionKey="ai.budget.update"
          target={{ type: "tenant", id: budgetTarget.tenant_id, label: budgetTarget.tenant_name }}
          canSubmit={/^\d+(\.\d{1,2})?$/.test(cap) && Number(cap) <= 10000}
          execute={async (a) =>
            (
              await platformRequest(
                "/api/v1/platform/ai/budget",
                { method: "PATCH", json: { tenant_id: budgetTarget.tenant_id, monthly_budget_usd: Number(cap), hard_cap_action: capAction, reason: a.reason } },
                a.stepUpToken
              )
            ).data
          }
          onDone={() => {
            setNotice(`AI cap for ${budgetTarget.tenant_name} updated.`);
            budgets.reload();
          }}
        >
          <span className={styles.hint}>
            Spent {usd(budgetTarget.spend_usd)} of {usd(budgetTarget.cap_usd)} this month.
          </span>
          <label className={styles.field}>
            Monthly cap (USD)
            <input className={styles.input} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d.]/g, ""))} />
          </label>
          <label className={styles.field}>
            At the hard cap
            <select className={styles.select} value={capAction} onChange={(e) => setCapAction(e.target.value)}>
              <option value="FALLBACK_TO_RULES">Fall back to rule-based replies</option>
              <option value="PAUSE_AND_ESCALATE">Pause the AI and hand over to people</option>
            </select>
          </label>
        </PrivilegedActionDialog>
      )}
    </>
  );
}
