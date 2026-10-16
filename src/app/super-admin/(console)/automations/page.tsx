"use client";

import React, { useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { PLATFORM_PERMISSIONS } from "@/lib/permissions";
import type { PlatformOverviewMetrics } from "@/domains/platform/services/platform-analytics.service";
import { usePlatformResource } from "../../_lib/use-platform-resource";
import { usePlatformSession } from "../../_lib/platform-session";
import { PlatformApiError, platformRequest } from "../../_lib/platform-client";
import { formatCount, formatDateTime, formatPercent, humanize, isPresent, NO_DATA } from "../../_lib/format";
import { CONSOLE_ROOT } from "../../_lib/platform-module-access";
import { PageHeader } from "../../_components/PageHeader";
import { ResourceView } from "../../_components/ResourceView";
import { StatusPill } from "../../_components/StatusPill";
import { Tabs, useTab, type TabDef } from "../../_components/Tabs";
import { PrivilegedActionDialog } from "../../_components/PrivilegedActionDialog";
import styles from "../../super-admin.module.css";

type TabId = "dlq" | "workflows" | "executions" | "webhooks" | "n8n" | "providers";

interface DeadLetter {
  id: string;
  tenant_id: string;
  tenant_name: string;
  automation_id: string;
  workflow_id: string;
  error: { code: string; message: string };
  attempt_count: number;
  last_attempt: string;
  status: string;
  timestamp: string;
}

interface AutomationsPayload {
  automations: Array<{ id: string; tenant_id: string; tenant_name: string; name: string; status: string; workflow_id: string }>;
  recent_executions: Array<{ id: string; tenant_id: string; tenant_name: string; automation_id: string; status: string; duration_ms?: number; error_message?: string; retry_count: number; created_at: string }>;
  dead_letters: DeadLetter[];
  circuit_breakers: Record<string, { state: string; failures: number; policy: string }>;
  webhooks: Array<{ id: string; tenant_name: string; provider: string; endpoint_path: string; secret_configured: boolean; signature_algorithm: string; is_active: boolean; last_event_at?: string; failure_rate: number }>;
  health: { active_automations_count: number; webhook_success_rate: number | null; average_duration_ms: number | null; retry_count: number; dead_letter_count: number; kill_switch_active: boolean; kill_switch_reason: string | null };
}

interface N8nPayload {
  instances: Array<{ id: string; name: string; base_url: string; environment: string; status: string; health_status: string; latency_ms?: number; workflow_count?: number; failure_rate?: number; last_health_check_at?: string }>;
  cluster_summary: { total: number; healthy: number; degraded: number };
}

const RAIL_LABELS: Record<string, string> = {
  steadfast_status: "Steadfast",
  pathao_status: "Pathao",
  bkash_status: "bKash",
  meta_status: "Meta",
};

export default function AutomationsPage() {
  const { can } = usePlatformSession();
  const tabs: TabDef<TabId>[] = [
    { id: "dlq", label: "Dead letters", visible: can(PLATFORM_PERMISSIONS.AUTOMATION_READ) },
    { id: "workflows", label: "Automations" },
    { id: "executions", label: "Executions" },
    { id: "webhooks", label: "Webhooks" },
    { id: "n8n", label: "n8n", visible: can(PLATFORM_PERMISSIONS.N8N_READ) },
    { id: "providers", label: "Provider rails" },
  ];
  const [tab, setTab] = useTab(tabs, "dlq");
  const [dialog, setDialog] = useState<{ kind: "retry" | "resolve"; dl: DeadLetter } | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const data = usePlatformResource<AutomationsPayload>(tab !== "n8n" ? "/api/v1/platform/automations" : null);
  const n8n = usePlatformResource<N8nPayload>(tab === "n8n" ? "/api/v1/platform/n8n" : null, { isEmpty: (d) => d.instances.length === 0 });
  const overview = usePlatformResource<PlatformOverviewMetrics>(tab === "providers" && can(PLATFORM_PERMISSIONS.PLATFORM_READ) ? "/api/v1/platform/overview" : null);

  const breaker = async (provider: string, action: "TRIP_CIRCUIT_BREAKER" | "RESET_CIRCUIT_BREAKER") => {
    setError(null);
    try {
      await platformRequest("/api/v1/platform/automations", { method: "POST", json: { action, provider_key: provider } });
      setNotice(`${provider} breaker ${action === "TRIP_CIRCUIT_BREAKER" ? "tripped: calls are refused" : "reset"}.`);
      setArmed(null);
      data.reload();
    } catch (err) {
      setError(err instanceof PlatformApiError ? `${err.message}${err.requestId ? ` (request ${err.requestId})` : ""}` : "The request failed.");
    }
  };

  const h = data.state.kind === "ready" ? data.state.data.health : null;

  return (
    <>
      <PageHeader
        title="Automations"
        description="Workflow fleet, dead letters, webhooks, n8n and provider circuit breakers across workspaces."
        fetchedAt={data.state.kind === "ready" ? data.state.fetchedAt : undefined}
        actions={
          <Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={() => { data.reload(); n8n.reload(); overview.reload(); }}>
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
      {error && (
        <div className={`${styles.banner} ${styles.bannerDanger}`} role="alert">
          <span>{error}</span>
        </div>
      )}

      {h && (
        <BentoGrid>
          <BentoCard span={3}>
            <div className={styles.kpiLabel}>Active automations</div>
            <div className={styles.kpiValue}>{formatCount(h.active_automations_count)}</div>
          </BentoCard>
          <BentoCard span={3}>
            <div className={styles.kpiLabel}>Execution success</div>
            <div className={isPresent(h.webhook_success_rate) ? styles.kpiValue : styles.kpiValueMuted}>
              {isPresent(h.webhook_success_rate) ? formatPercent(h.webhook_success_rate * 100) : NO_DATA}
            </div>
            <div className={styles.kpiSub}>{isPresent(h.average_duration_ms) ? `avg ${formatCount(h.average_duration_ms)} ms` : ""}</div>
          </BentoCard>
          <BentoCard span={3}>
            <div className={styles.kpiLabel}>Dead letters</div>
            <div className={styles.kpiValue}>{formatCount(h.dead_letter_count)}</div>
            <div className={styles.kpiSub}>{formatCount(h.retry_count)} retries pending</div>
          </BentoCard>
          <BentoCard span={3}>
            <div className={styles.kpiLabel}>Automation kill switch</div>
            <div className={styles.kpiValue}>
              <StatusPill status={h.kill_switch_active ? "BLOCKED" : "DISABLED"} tone={h.kill_switch_active ? "bad" : "ok"} label={h.kill_switch_active ? "Active" : "Off"} />
            </div>
            {h.kill_switch_reason && <div className={styles.kpiSub}>{h.kill_switch_reason}</div>}
          </BentoCard>
        </BentoGrid>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "dlq" && (
        <BentoCard span={12} title="Dead letters" subtitle="Events that failed every retry">
          <ResourceView
            state={data.state.kind === "ready" && data.state.data.dead_letters.length === 0 ? { kind: "empty", fetchedAt: data.state.fetchedAt } : data.state}
            onRetry={data.reload}
            resource="dead letters"
            emptyFigure="queue-empty"
            emptyTitle="No dead letters"
            emptyDescription="Failed events land here after their retries run out."
            renderReady={(d) => (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Failed</th>
                      <th>Workspace</th>
                      <th>Error</th>
                      <th className={styles.numeric}>Attempts</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {d.dead_letters.map((dl) => (
                      <tr key={dl.id}>
                        <td>{formatDateTime(dl.timestamp)}</td>
                        <td>
                          <Link href={`${CONSOLE_ROOT}/tenants/${encodeURIComponent(dl.tenant_id)}`}>{dl.tenant_name}</Link>
                        </td>
                        <td>
                          <span className={styles.rowMain}>
                            <span className={styles.mono}>{dl.error.code}</span>
                            <span className={styles.rowMeta}>{dl.error.message}</span>
                          </span>
                        </td>
                        <td className={styles.numeric}>{formatCount(dl.attempt_count)}</td>
                        <td>
                          <StatusPill status={dl.status} tone={dl.status === "UNRESOLVED" ? "warn" : undefined} />
                        </td>
                        <td>
                          {dl.status === "UNRESOLVED" && (
                            <div className={styles.inlineActions}>
                              {can(PLATFORM_PERMISSIONS.DLQ_RETRY) && (
                                <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "retry", dl })}>
                                  Retry
                                </Button>
                              )}
                              {can(PLATFORM_PERMISSIONS.DLQ_RESOLVE) && (
                                <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "resolve", dl })}>
                                  Resolve
                                </Button>
                              )}
                            </div>
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

      {tab === "workflows" && (
        <BentoCard span={12} title="Automations" subtitle="The first 100 across workspaces">
          <ResourceView
            state={data.state.kind === "ready" && data.state.data.automations.length === 0 ? { kind: "empty", fetchedAt: data.state.fetchedAt } : data.state}
            onRetry={data.reload}
            resource="automations"
            emptyFigure="infrastructure-empty"
            emptyTitle="No automations"
            emptyDescription="Workspaces create automations from their Automations page."
            renderReady={(d) => (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Automation</th>
                      <th>Workspace</th>
                      <th>Workflow</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.automations.map((a) => (
                      <tr key={a.id}>
                        <td>{a.name}</td>
                        <td>{a.tenant_name}</td>
                        <td className={styles.mono}>{a.workflow_id}</td>
                        <td>
                          <StatusPill status={a.status} />
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

      {tab === "executions" && (
        <BentoCard span={12} title="Recent executions" subtitle="The latest 50">
          <ResourceView
            state={data.state.kind === "ready" && data.state.data.recent_executions.length === 0 ? { kind: "empty", fetchedAt: data.state.fetchedAt } : data.state}
            onRetry={data.reload}
            resource="executions"
            emptyFigure="log-empty"
            emptyTitle="No executions yet"
            emptyDescription="Runs appear when automations trigger."
            renderReady={(d) => (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Workspace</th>
                      <th>Status</th>
                      <th className={styles.numeric}>Duration</th>
                      <th className={styles.numeric}>Retries</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.recent_executions.map((e) => (
                      <tr key={e.id}>
                        <td>{formatDateTime(e.created_at)}</td>
                        <td>{e.tenant_name}</td>
                        <td>
                          <StatusPill status={e.status} />
                        </td>
                        <td className={styles.numeric}>{isPresent(e.duration_ms) ? `${formatCount(e.duration_ms)} ms` : "—"}</td>
                        <td className={styles.numeric}>{formatCount(e.retry_count)}</td>
                        <td>{e.error_message ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          />
        </BentoCard>
      )}

      {tab === "webhooks" && (
        <BentoCard span={12} title="Inbound webhooks">
          <ResourceView
            state={data.state.kind === "ready" && data.state.data.webhooks.length === 0 ? { kind: "empty", fetchedAt: data.state.fetchedAt } : data.state}
            onRetry={data.reload}
            resource="webhooks"
            emptyFigure="network-empty"
            emptyTitle="No webhooks registered"
            emptyDescription="Courier, payment and channel webhooks appear here once configured."
            renderReady={(d) => (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Workspace</th>
                      <th>Path</th>
                      <th>Signature</th>
                      <th>Last event</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.webhooks.map((w) => (
                      <tr key={w.id}>
                        <td>{w.provider}</td>
                        <td>{w.tenant_name}</td>
                        <td className={styles.mono}>{w.endpoint_path}</td>
                        <td>
                          {w.secret_configured ? (
                            <StatusPill status="ACTIVE" label={w.signature_algorithm} />
                          ) : (
                            <StatusPill status="NOT_VERIFIED" label="No secret" />
                          )}
                        </td>
                        <td>{formatDateTime(w.last_event_at)}</td>
                        <td>
                          <StatusPill status={w.is_active ? "ACTIVE" : "DISABLED"} />
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

      {tab === "n8n" && (
        <BentoCard span={12} title="n8n instances" subtitle="Health as last checked by the platform">
          <ResourceView
            state={n8n.state}
            onRetry={n8n.reload}
            resource="n8n instances"
            emptyFigure="infrastructure-empty"
            emptyTitle="No n8n instance registered"
            emptyDescription="Automations call n8n only after an instance is configured (COMMERCEOS_N8N_* settings)."
            renderReady={(d) => (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Instance</th>
                      <th>Environment</th>
                      <th>Health</th>
                      <th className={styles.numeric}>Workflows</th>
                      <th>Last check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.instances.map((i) => (
                      <tr key={i.id}>
                        <td>
                          <span className={styles.rowMain}>
                            <span className={styles.rowTitle}>{i.name}</span>
                            <span className={styles.rowMeta}>{i.base_url}</span>
                          </span>
                        </td>
                        <td>{humanize(i.environment)}</td>
                        <td>
                          <StatusPill status={i.health_status} />
                        </td>
                        <td className={styles.numeric}>{isPresent(i.workflow_count) ? formatCount(i.workflow_count) : "—"}</td>
                        <td>{formatDateTime(i.last_health_check_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          />
        </BentoCard>
      )}

      {tab === "providers" && (
        <BentoGrid>
          <BentoCard span={6} title="Provider rails" subtitle="SIMULATED: no live adapter, nothing is sent">
            {overview.state.kind === "ready" ? (
              <ul className={styles.list}>
                {Object.entries(overview.state.data.provider_health).map(([k, v]) => (
                  <li key={k} className={styles.listRow}>
                    <span>{RAIL_LABELS[k] ?? humanize(k)}</span>
                    <StatusPill status={v} />
                  </li>
                ))}
              </ul>
            ) : (
              <ResourceView
                state={overview.state}
                onRetry={overview.reload}
                resource="provider rails"
                emptyFigure="disconnected"
                emptyTitle="No provider data"
                emptyDescription="The overview API reported no rails."
                renderReady={() => null}
              />
            )}
          </BentoCard>
          <BentoCard span={6} title="Circuit breakers" subtitle="Breaker state on this server: OPEN refuses calls until reset">
            {data.state.kind === "ready" ? (
              <ul className={styles.list}>
                {Object.entries(data.state.data.circuit_breakers).map(([provider, b]) => (
                  <li key={provider} className={styles.listRow}>
                    <span className={styles.rowMain}>
                      <span className={styles.rowTitle}>{provider}</span>
                      <span className={styles.rowMeta}>
                        {formatCount(b.failures)} consecutive failures · {b.policy}
                      </span>
                    </span>
                    <span className={styles.inlineActions}>
                      <StatusPill status={b.state === "OPEN" ? "BLOCKED" : b.state === "DEGRADED" ? "DEGRADED" : "ACTIVE"} label={humanize(b.state)} />
                      {can(PLATFORM_PERMISSIONS.PROVIDER_MANAGE) &&
                        (armed === provider ? (
                          <>
                            <Button size="sm" variant={b.state === "OPEN" ? "primary" : "danger"} onClick={() => breaker(provider, b.state === "OPEN" ? "RESET_CIRCUIT_BREAKER" : "TRIP_CIRCUIT_BREAKER")}>
                              Confirm {b.state === "OPEN" ? "reset" : "trip"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setArmed(null)}>
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setArmed(provider)}>
                            {b.state === "OPEN" ? "Reset" : "Trip"}
                          </Button>
                        ))}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <ResourceView state={data.state} onRetry={data.reload} resource="circuit breakers" emptyFigure="disconnected" emptyTitle="No breakers" emptyDescription="" renderReady={() => null} />
            )}
          </BentoCard>
        </BentoGrid>
      )}

      {dialog && (
        <PrivilegedActionDialog
          open
          onClose={() => setDialog(null)}
          actionKey={dialog.kind === "retry" ? "dlq.retry" : "dlq.resolve"}
          target={{ type: "platform", id: dialog.dl.id, label: `${dialog.dl.tenant_name} · ${dialog.dl.error.code}` }}
          execute={async (a) =>
            (
              await platformRequest("/api/v1/platform/automations", {
                method: "POST",
                json: {
                  action: dialog.kind === "retry" ? "RETRY_DEAD_LETTER" : "RESOLVE_DEAD_LETTER",
                  dead_letter_id: dialog.dl.id,
                  ...(dialog.kind === "resolve" ? { notes: a.reason } : {}),
                },
              })
            ).data
          }
          onDone={() => {
            setNotice(dialog.kind === "retry" ? "Dead letter replayed." : "Dead letter marked resolved.");
            data.reload();
          }}
        >
          <span className={styles.hint}>
            {dialog.dl.error.message} · {formatCount(dialog.dl.attempt_count)} attempts, last {formatDateTime(dialog.dl.last_attempt)}
          </span>
        </PrivilegedActionDialog>
      )}
    </>
  );
}
