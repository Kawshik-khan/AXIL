"use client";

import React from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { PermissionDenied } from "@/components/ui/States/States";
import { PLATFORM_PERMISSIONS } from "@/lib/permissions";
import type { PlatformOverviewMetrics, ProviderRailStatus } from "@/domains/platform/services/platform-analytics.service";
import type { PlatformAuditLogRecord } from "@/types/platform";
import type { AttentionItem } from "@/domains/platform/services/platform-attention.service";
import { usePlatformResource } from "../_lib/use-platform-resource";
import { usePlatformSession } from "../_lib/platform-session";
import {
  formatCount,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatRelative,
  humanize,
  isPresent,
  NO_DATA,
} from "../_lib/format";
import { PageHeader } from "../_components/PageHeader";
import { ResourceView } from "../_components/ResourceView";
import { StatusPill, type StatusTone } from "../_components/StatusPill";
import { CONSOLE_ROOT } from "../_lib/platform-module-access";
import styles from "../super-admin.module.css";

const OVERVIEW_REFRESH_MS = 60_000;

const PROVIDER_LABELS: Record<keyof PlatformOverviewMetrics["provider_health"], string> = {
  steadfast_status: "Steadfast courier",
  pathao_status: "Pathao courier",
  bkash_status: "bKash payments",
  meta_status: "Meta (Facebook / Instagram / WhatsApp)",
};

const SEVERITY_TONE: Record<AttentionItem["severity"], StatusTone> = {
  CRITICAL: "bad",
  HIGH: "bad",
  MEDIUM: "warn",
  LOW: "info",
};

function Kpi({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  const missing = value === NO_DATA;
  return (
    <>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={missing ? styles.kpiValueMuted : styles.kpiValue}>{value}</div>
      {sub && <div className={styles.kpiSub}>{sub}</div>}
    </>
  );
}

export default function ControlTowerPage() {
  const { can } = usePlatformSession();
  const overview = usePlatformResource<PlatformOverviewMetrics>("/api/v1/platform/overview", {
    refreshMs: OVERVIEW_REFRESH_MS,
  });
  const attention = usePlatformResource<AttentionItem[]>("/api/v1/platform/attention", {
    refreshMs: OVERVIEW_REFRESH_MS,
    isEmpty: (items) => items.length === 0,
  });
  const canReadAudit = can(PLATFORM_PERMISSIONS.AUDIT_READ);
  const audit = usePlatformResource<PlatformAuditLogRecord[]>(canReadAudit ? "/api/v1/platform/audit?limit=10" : null, {
    isEmpty: (logs) => logs.length === 0,
  });

  const reloadAll = () => {
    overview.reload();
    attention.reload();
    if (canReadAudit) audit.reload();
  };

  const fetchedAt = overview.state.kind === "ready" ? overview.state.fetchedAt : undefined;

  return (
    <>
      <PageHeader
        title="Control Tower"
        description="Live platform state from the overview, attention and audit APIs. Refreshes every minute while this tab is visible."
        fetchedAt={fetchedAt}
        actions={
          <Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={reloadAll}>
            Refresh
          </Button>
        }
      />

      <ResourceView
        state={overview.state}
        onRetry={overview.reload}
        resource="the platform overview"
        emptyFigure="no-data"
        emptyTitle="No overview data"
        emptyDescription="The overview API returned nothing to show."
        skeletonLines={6}
        renderReady={(o) => (
          <BentoGrid>
            {/* Status strip */}
            <BentoCard span={12} className={styles.darkCard}>
              <div className={styles.strip}>
                <div className={styles.stripItem}>
                  <span className={styles.stripLabel}>Kill switches</span>
                  <span className={styles.stripValue}>
                    <StatusPill
                      status={o.infrastructure.kill_switch_active ? "ACTIVE" : "DISABLED"}
                      tone={o.infrastructure.kill_switch_active ? "bad" : "ok"}
                      label={o.infrastructure.kill_switch_active ? "At least one active" : "None active"}
                    />
                  </span>
                </div>
                <div className={styles.stripItem}>
                  <span className={styles.stripLabel}>Open incidents</span>
                  <span className={styles.stripValue}>{formatCount(o.infrastructure.open_incidents_count)}</span>
                </div>
                <div className={styles.stripItem}>
                  <span className={styles.stripLabel}>Support sessions active</span>
                  <span className={styles.stripValue}>{formatCount(o.security.active_impersonation_sessions)}</span>
                </div>
                <div className={styles.stripItem}>
                  <span className={styles.stripLabel}>Operators with MFA</span>
                  <span className={styles.stripValue}>{formatPercent(o.security.mfa_enforced_percent, 0)}</span>
                </div>
              </div>
            </BentoCard>

            {/* KPI row */}
            <BentoCard span={3}>
              <Kpi
                label="Tenants"
                value={formatCount(o.tenants.total)}
                sub={
                  <>
                    <span>{formatCount(o.tenants.active)} active</span>
                    <span>{formatCount(o.tenants.trial)} trial</span>
                    <span>{formatCount(o.tenants.suspended)} suspended</span>
                  </>
                }
              />
            </BentoCard>
            <BentoCard span={3}>
              <Kpi
                label="Monthly recurring revenue"
                value={o.financials.active_subscriptions_count > 0 ? formatMoney(o.financials.mrr_bdt, o.financials.currency) : NO_DATA}
                sub={
                  <>
                    <span>{formatCount(o.financials.active_subscriptions_count)} paying subscriptions</span>
                    {o.financials.active_subscriptions_count > 0 && (
                      <span>ARPU {formatMoney(o.financials.arpu_bdt, o.financials.currency)}</span>
                    )}
                  </>
                }
              />
            </BentoCard>
            <BentoCard span={3}>
              <Kpi
                label="GMV processed"
                value={o.commerce_velocity.total_orders_count > 0 ? formatMoney(o.commerce_velocity.total_gmv_bdt, "BDT") : NO_DATA}
                sub={
                  <>
                    <span>{formatCount(o.commerce_velocity.total_orders_count)} orders</span>
                    {isPresent(o.commerce_velocity.cod_percentage) && (
                      <span>{formatPercent(o.commerce_velocity.cod_percentage, 0)} COD</span>
                    )}
                  </>
                }
              />
            </BentoCard>
            <BentoCard span={3}>
              <Kpi
                label="AI spend (estimated)"
                value={o.ai_fleet.total_tokens > 0 ? formatMoney(o.ai_fleet.estimated_cost_bdt, "BDT") : NO_DATA}
                sub={
                  <>
                    <span>{formatCount(o.ai_fleet.total_tokens)} tokens</span>
                    {isPresent(o.ai_fleet.autonomous_resolution_rate) && (
                      <span>{formatPercent(o.ai_fleet.autonomous_resolution_rate)} runs completed</span>
                    )}
                  </>
                }
              />
            </BentoCard>

            {/* Attention inbox */}
            <BentoCard span={8} className={styles.darkCard} title="Needs attention" subtitle="Computed live from platform state">
              <ResourceView
                state={attention.state}
                onRetry={attention.reload}
                resource="the attention inbox"
                surface="dark"
                emptyFigure="all-clear"
                emptyTitle="Nothing needs attention"
                emptyDescription="No limits near capacity, incidents, kill switches, dead letters, pending approvals or MFA gaps right now."
                renderReady={(items) => (
                  <ul className={styles.list}>
                    {items.map((item) => (
                      <li key={item.id} className={styles.listRow}>
                        <Link href={item.href} className={`${styles.rowMain} ${styles.rowLink}`}>
                          <span className={styles.rowTitle}>{item.title}</span>
                          <span className={styles.rowMeta}>
                            {item.detail} · {formatRelative(item.observed_at)}
                          </span>
                        </Link>
                        <StatusPill status={item.severity} tone={SEVERITY_TONE[item.severity]} />
                      </li>
                    ))}
                  </ul>
                )}
              />
            </BentoCard>

            {/* Subsystem health */}
            <BentoCard span={4} title="Subsystems" subtitle="As reported by the platform; SIMULATED means no live adapter">
              <ul className={styles.list}>
                {(Object.keys(PROVIDER_LABELS) as Array<keyof typeof PROVIDER_LABELS>).map((key) => {
                  const status: ProviderRailStatus = o.provider_health[key];
                  return (
                    <li key={key} className={styles.listRow}>
                      <span className={styles.rowTitle}>{PROVIDER_LABELS[key]}</span>
                      <StatusPill status={status} />
                    </li>
                  );
                })}
              </ul>
            </BentoCard>

            {/* Recent privileged actions */}
            <BentoCard
              span={12}
              title="Recent privileged actions"
              subtitle="The last 10 platform audit entries"
              action={
                canReadAudit ? (
                  <Link href={`${CONSOLE_ROOT}/audit`} className={styles.asOf}>
                    Open audit
                  </Link>
                ) : undefined
              }
            >
              {canReadAudit ? (
                <ResourceView
                  state={audit.state}
                  onRetry={audit.reload}
                  resource="the audit log"
                  emptyFigure="log-empty"
                  emptyTitle="No privileged actions yet"
                  emptyDescription="Platform actions such as suspensions, plan changes and kill switches will appear here."
                  renderReady={(logs) => (
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>When</th>
                            <th>Action</th>
                            <th>Target</th>
                            <th>Role</th>
                            <th>Reason</th>
                            <th>Result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {logs.map((log) => (
                            <tr key={log.id}>
                              <td>{formatDateTime(log.created_at)}</td>
                              <td className={styles.mono}>{log.action}</td>
                              <td>
                                {log.target_tenant_id ? (
                                  <Link href={`${CONSOLE_ROOT}/tenants/${encodeURIComponent(log.target_tenant_id)}`}>
                                    {log.target_tenant_id}
                                  </Link>
                                ) : (
                                  `${log.resource_type} ${log.resource_id}`
                                )}
                              </td>
                              <td>{humanize(log.platform_role)}</td>
                              <td>{log.reason}</td>
                              <td>
                                <StatusPill status={log.result} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                />
              ) : (
                <PermissionDenied resource="the audit log" requiredPermission={PLATFORM_PERMISSIONS.AUDIT_READ} inline />
              )}
            </BentoCard>
          </BentoGrid>
        )}
      />
    </>
  );
}
