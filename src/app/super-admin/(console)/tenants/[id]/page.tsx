"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { PermissionDenied } from "@/components/ui/States/States";
import { PLATFORM_PERMISSIONS } from "@/lib/permissions";
import { findEntitlementSpec } from "@/domains/platform/entitlement-catalog";
import type { TenantEntitlementReport, EffectiveEntitlement } from "@/domains/platform/services/platform-entitlement.service";
import type { TenantAddonView, AddonView } from "@/domains/platform/services/platform-addon.service";
import type { PlanView } from "@/domains/platform/services/platform-plan.service";
import type { PlatformAuditLogRecord, ImpersonationSessionRecord } from "@/types/platform";
import { usePlatformResource } from "../../../_lib/use-platform-resource";
import { usePlatformSession } from "../../../_lib/platform-session";
import { platformRequest } from "../../../_lib/platform-client";
import { formatCount, formatCountdown, formatDateTime, humanize, NO_DATA } from "../../../_lib/format";
import { CONSOLE_ROOT } from "../../../_lib/platform-module-access";
import { PageHeader } from "../../../_components/PageHeader";
import { ResourceView } from "../../../_components/ResourceView";
import { StatusPill } from "../../../_components/StatusPill";
import { Tabs, useTab, type TabDef } from "../../../_components/Tabs";
import { PrivilegedActionDialog, type ExecuteArgs } from "../../../_components/PrivilegedActionDialog";
import styles from "../../../super-admin.module.css";

interface TenantDetail {
  tenant: {
    id: string;
    name: string;
    slug: string;
    legal_name?: string;
    status: string;
    currency: string;
    timezone: string;
    country?: string;
    plan_id?: string;
    suspended_at?: string;
    suspension_reason?: string;
    archived_at?: string;
    purge_after?: string;
    created_at: string;
  };
  subscription:
    | (Record<string, unknown> & {
        id: string;
        plan_id: string;
        plan_version_id: string;
        status: string;
        billing_period?: string;
        trial_ends_at?: string;
        current_period_end: string;
        plan_name?: string;
        plan_version?: number;
      })
    | null;
  staff: Array<{ membership_id: string; name: string | null; email: string | null; role: string; status: string | null; created_at: string }>;
  automation_telemetry: { total_automations: number; dead_letter_count: number };
}

type TabId = "overview" | "usage" | "commercial" | "support" | "audit";

type DialogState =
  | { kind: "suspend" | "activate" | "archive" | "purge" | "purge_cancel" }
  | { kind: "override"; ent: EffectiveEntitlement }
  | { kind: "clear_override"; ent: EffectiveEntitlement }
  | { kind: "change_plan" | "start_trial" | "extend_trial" }
  | { kind: "grant_addon" }
  | { kind: "revoke_addon"; grant: TenantAddonView }
  | { kind: "support" }
  | null;

function valueLabel(e: Pick<EffectiveEntitlement, "value" | "kind" | "unit">): string {
  if (e.value === null) return "Unlimited";
  if (typeof e.value === "boolean") return e.value ? "On" : "Off";
  return `${formatCount(e.value)}${e.unit ? ` ${e.unit}` : ""}`;
}

export default function TenantDetailPage() {
  const params = useParams<{ id: string }>();
  const tenantId = params?.id ? decodeURIComponent(params.id) : null;
  const base = tenantId ? `/api/v1/platform/tenants/${encodeURIComponent(tenantId)}` : null;
  const { can } = usePlatformSession();

  const tabs: TabDef<TabId>[] = [
    { id: "overview", label: "Overview" },
    { id: "usage", label: "Usage & limits", visible: can(PLATFORM_PERMISSIONS.ENTITLEMENT_READ) },
    { id: "commercial", label: "Commercial", visible: can(PLATFORM_PERMISSIONS.SUBSCRIPTION_READ) || can(PLATFORM_PERMISSIONS.ENTITLEMENT_READ) },
    { id: "support", label: "Support", visible: can(PLATFORM_PERMISSIONS.SUPPORT_READ) },
    { id: "audit", label: "Audit", visible: can(PLATFORM_PERMISSIONS.AUDIT_READ) },
  ];
  const [tab, setTab] = useTab(tabs, "overview");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const detail = usePlatformResource<TenantDetail>(base);
  const report = usePlatformResource<TenantEntitlementReport>(
    base && (tab === "usage" || tab === "commercial") && can(PLATFORM_PERMISSIONS.ENTITLEMENT_READ) ? `${base}/entitlements` : null
  );
  const grants = usePlatformResource<TenantAddonView[]>(
    base && tab === "commercial" && can(PLATFORM_PERMISSIONS.ENTITLEMENT_READ) ? `${base}/addons` : null,
    { isEmpty: (g) => g.length === 0 }
  );
  const addonCatalog = usePlatformResource<AddonView[]>(tab === "commercial" && can(PLATFORM_PERMISSIONS.PLAN_READ) ? "/api/v1/platform/addons" : null);
  const plans = usePlatformResource<PlanView[]>(tab === "commercial" && can(PLATFORM_PERMISSIONS.PLAN_READ) ? "/api/v1/platform/plans" : null);
  const sessions = usePlatformResource<ImpersonationSessionRecord[]>(tab === "support" ? "/api/v1/platform/support/impersonate" : null);
  const audit = usePlatformResource<PlatformAuditLogRecord[]>(
    tenantId && tab === "audit" ? `/api/v1/platform/audit?tenantId=${encodeURIComponent(tenantId)}&limit=50` : null,
    { isEmpty: (l) => l.length === 0 }
  );

  // Inputs for the dialogs that need values
  const [overrideValue, setOverrideValue] = useState<string>("");
  const [overrideUnlimited, setOverrideUnlimited] = useState(false);
  const [overrideExpiry, setOverrideExpiry] = useState("");
  const [planChoice, setPlanChoice] = useState("");
  const [periodChoice, setPeriodChoice] = useState<"" | "MONTHLY" | "ANNUAL">("");
  const [endTrial, setEndTrial] = useState(false);
  const [trialEnd, setTrialEnd] = useState("");
  const [addonChoice, setAddonChoice] = useState("");
  const [addonQty, setAddonQty] = useState("1");
  const [addonEnds, setAddonEnds] = useState("");
  const [supportMinutes, setSupportMinutes] = useState("30");

  const reloadAll = () => {
    detail.reload();
    report.reload();
    grants.reload();
    sessions.reload();
    audit.reload();
  };

  const done = (message: string) => () => {
    setNotice(message);
    reloadAll();
  };

  const tenantSessions = useMemo(
    () => (sessions.state.kind === "ready" ? sessions.state.data.filter((s) => s.target_tenant_id === tenantId) : []),
    [sessions.state, tenantId]
  );

  if (!tenantId) return null;

  const post = (path: string, json: unknown, stepUp: string | null) => platformRequest(`${base}${path}`, { method: "POST", json }, stepUp).then((r) => r.data);

  return (
    <>
      <Link href={`${CONSOLE_ROOT}/tenants`} className={styles.asOf}>
        <ArrowLeft size={12} /> All tenants
      </Link>

      <ResourceView
        state={detail.state}
        onRetry={detail.reload}
        resource="this tenant"
        emptyFigure="no-results"
        emptyTitle="Tenant not found"
        emptyDescription="It may have been removed, or the link is wrong."
        skeletonLines={6}
        renderReady={(d) => {
          const t = d.tenant;
          const sub = d.subscription;
          return (
            <>
              <PageHeader
                title={t.name}
                description={`${t.slug} · created ${formatDateTime(t.created_at)}`}
                fetchedAt={detail.state.kind === "ready" ? detail.state.fetchedAt : undefined}
                actions={
                  <>
                    <StatusPill status={t.status} />
                    <Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={reloadAll}>
                      Refresh
                    </Button>
                    {can(PLATFORM_PERMISSIONS.SUPPORT_IMPERSONATE) && t.status !== "ARCHIVED" && (
                      <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "support" })}>
                        Start support session
                      </Button>
                    )}
                    {can(PLATFORM_PERMISSIONS.TENANT_SUSPEND) && t.status !== "SUSPENDED" && t.status !== "ARCHIVED" && (
                      <Button variant="danger" size="sm" onClick={() => setDialog({ kind: "suspend" })}>
                        Suspend
                      </Button>
                    )}
                    {can(PLATFORM_PERMISSIONS.TENANT_ACTIVATE) && t.status === "SUSPENDED" && (
                      <Button size="sm" onClick={() => setDialog({ kind: "activate" })}>
                        Reactivate
                      </Button>
                    )}
                  </>
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
              {t.status === "SUSPENDED" && (
                <div className={`${styles.banner} ${styles.bannerDanger}`}>
                  <span>
                    Suspended {formatDateTime(t.suspended_at)}: {t.suspension_reason ?? "no reason recorded"}
                  </span>
                </div>
              )}
              {t.purge_after && (
                <div className={`${styles.banner} ${styles.bannerDanger}`}>
                  <span>Purge scheduled. Data is kept until {formatDateTime(t.purge_after)}; no deletion job exists yet.</span>
                </div>
              )}

              <Tabs tabs={tabs} active={tab} onChange={setTab} />

              {tab === "overview" && (
                <BentoGrid>
                  <BentoCard span={6} title="Workspace">
                    <dl className={styles.definition}>
                      <dt>Tenant id</dt>
                      <dd className={styles.mono}>{t.id}</dd>
                      <dt>Legal name</dt>
                      <dd>{t.legal_name ?? "Not set"}</dd>
                      <dt>Region</dt>
                      <dd>
                        {t.country ?? "Country not set"} · {t.currency} · {t.timezone}
                      </dd>
                      <dt>Plan</dt>
                      <dd>{sub ? `${sub.plan_name ?? sub.plan_id} v${sub.plan_version ?? "?"} · ${humanize(sub.status)}` : "No subscription"}</dd>
                      <dt>Automations</dt>
                      <dd>
                        {formatCount(d.automation_telemetry.total_automations)} · {formatCount(d.automation_telemetry.dead_letter_count)} dead letters
                      </dd>
                    </dl>
                  </BentoCard>
                  <BentoCard span={6} title="Lifecycle" subtitle="High-risk actions ask for step-up; older tenants need a second operator to suspend">
                    <div className={styles.sectionGap}>
                      {can(PLATFORM_PERMISSIONS.TENANT_ARCHIVE) && t.status !== "ARCHIVED" && (
                        <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "archive" })}>
                          Archive workspace
                        </Button>
                      )}
                      {can(PLATFORM_PERMISSIONS.TENANT_DELETE) && !t.purge_after && (
                        <div className={styles.dangerZone}>
                          <strong>Purge</strong>
                          <span className={styles.hint}>
                            Two operators, typed confirmation. Archives now and keeps data 14 days; deletion itself is not built yet.
                          </span>
                          <Button variant="danger" size="sm" onClick={() => setDialog({ kind: "purge" })}>
                            Schedule purge
                          </Button>
                        </div>
                      )}
                      {can(PLATFORM_PERMISSIONS.TENANT_DELETE) && t.purge_after && (
                        <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "purge_cancel" })}>
                          Cancel scheduled purge
                        </Button>
                      )}
                      {!can(PLATFORM_PERMISSIONS.TENANT_ARCHIVE) && !can(PLATFORM_PERMISSIONS.TENANT_DELETE) && (
                        <span className={styles.hint}>Your role has no lifecycle actions.</span>
                      )}
                    </div>
                  </BentoCard>
                  <BentoCard span={12} title="Staff" subtitle="Workspace members (platform operators never become members)">
                    {d.staff.length === 0 ? (
                      <span className={styles.muted}>No members.</span>
                    ) : (
                      <div className={styles.tableWrap}>
                        <table className={styles.table}>
                          <thead>
                            <tr>
                              <th>Name</th>
                              <th>Email</th>
                              <th>Role</th>
                              <th>Account</th>
                              <th>Joined</th>
                            </tr>
                          </thead>
                          <tbody>
                            {d.staff.map((m) => (
                              <tr key={m.membership_id}>
                                <td>{m.name ?? NO_DATA}</td>
                                <td>{m.email ?? NO_DATA}</td>
                                <td>{humanize(m.role)}</td>
                                <td>{m.status ? <StatusPill status={m.status} /> : NO_DATA}</td>
                                <td>{formatDateTime(m.created_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </BentoCard>
                </BentoGrid>
              )}

              {tab === "usage" && (
                <BentoCard span={12} title="Usage & limits" subtitle="Value in force = unexpired override → plan (+ add-ons) → global default">
                  <ResourceView
                    state={report.state}
                    onRetry={report.reload}
                    resource="entitlements"
                    emptyFigure="no-data"
                    emptyTitle="No entitlement data"
                    emptyDescription="The entitlement report is empty."
                    renderReady={(r) => (
                      <div className={styles.sectionGap}>
                        <span className={styles.hint}>
                          Plan {r.plan.plan_id ?? "none"}
                          {r.plan.version ? ` v${r.plan.version}` : ""}: {r.plan.applies ? "applies" : "does not apply"} ({r.plan.reason}).
                        </span>
                        {r.unknown_plan_keys.length > 0 && (
                          <div className={`${styles.banner} ${styles.bannerWarning}`}>
                            <span>
                              The plan stores keys nothing enforces, so they are ignored: {r.unknown_plan_keys.join(", ")}.
                            </span>
                          </div>
                        )}
                        <div className={styles.tableWrap}>
                          <table className={styles.table}>
                            <thead>
                              <tr>
                                <th>Limit</th>
                                <th>In force</th>
                                <th>From</th>
                                <th>Usage</th>
                                <th>Override</th>
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {r.entitlements.map((e) => {
                                const pct = e.usage_ratio === null ? null : Math.min(100, Math.round(e.usage_ratio * 100));
                                return (
                                  <tr key={e.id}>
                                    <td>
                                      <span className={styles.rowMain}>
                                        <span className={styles.rowTitle}>{e.label}</span>
                                        <span className={styles.rowMeta}>{e.enforced ? humanize(e.kind) : "Not enforced yet"}</span>
                                      </span>
                                    </td>
                                    <td>{e.enforced ? valueLabel(e) : <span className={styles.muted}>—</span>}</td>
                                    <td>
                                      {e.enforced ? (
                                        <>
                                          {humanize(e.source)}
                                          {e.addon_increment > 0 && <span className={styles.rowMeta}> (+{formatCount(e.addon_increment)} add-ons)</span>}
                                        </>
                                      ) : (
                                        "—"
                                      )}
                                    </td>
                                    <td>
                                      {e.usage === null ? (
                                        "—"
                                      ) : (
                                        <span className={styles.rowMain}>
                                          <span>{formatCount(e.usage)}</span>
                                          {pct !== null && (
                                            <span className={styles.progressTrack} aria-label={`${pct}% of limit`}>
                                              <span
                                                className={`${styles.progressFill} ${pct >= 100 ? styles.progressBad : pct >= 90 ? styles.progressWarn : ""}`}
                                                style={{ width: `${pct}%` }}
                                              />
                                            </span>
                                          )}
                                        </span>
                                      )}
                                    </td>
                                    <td>
                                      {e.override ? (
                                        <span className={styles.rowMain}>
                                          <span>{e.override.expired ? "Expired" : "Active"}</span>
                                          <span className={styles.rowMeta}>
                                            {e.override.expires_at ? `until ${formatDateTime(e.override.expires_at)}` : "no expiry"} · {e.override.reason}
                                          </span>
                                        </span>
                                      ) : (
                                        "—"
                                      )}
                                    </td>
                                    <td>
                                      {e.enforced && can(PLATFORM_PERMISSIONS.ENTITLEMENT_MANAGE) && (
                                        <div className={styles.inlineActions}>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => {
                                              setOverrideValue(typeof e.value === "number" ? String(e.value) : "");
                                              setOverrideUnlimited(false);
                                              setOverrideExpiry("");
                                              setDialog({ kind: "override", ent: e });
                                            }}
                                          >
                                            Override
                                          </Button>
                                          {e.override && !e.override.expired && (
                                            <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "clear_override", ent: e })}>
                                              Clear
                                            </Button>
                                          )}
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  />
                </BentoCard>
              )}

              {tab === "commercial" && (
                <BentoGrid>
                  <BentoCard span={6} title="Subscription">
                    {sub ? (
                      <div className={styles.sectionGap}>
                        <dl className={styles.definition}>
                          <dt>Plan</dt>
                          <dd>
                            {sub.plan_name ?? sub.plan_id} v{sub.plan_version ?? "?"}
                          </dd>
                          <dt>Status</dt>
                          <dd>
                            <StatusPill status={sub.status} />
                          </dd>
                          <dt>Billing period</dt>
                          <dd>{sub.billing_period ? humanize(sub.billing_period) : NO_DATA}</dd>
                          <dt>Period ends</dt>
                          <dd>{formatDateTime(sub.current_period_end)}</dd>
                          {sub.trial_ends_at && (
                            <>
                              <dt>Trial ends</dt>
                              <dd>
                                {formatDateTime(sub.trial_ends_at)} ({formatCountdown(sub.trial_ends_at)})
                              </dd>
                            </>
                          )}
                        </dl>
                        {can(PLATFORM_PERMISSIONS.SUBSCRIPTION_MANAGE) && (
                          <div className={styles.inlineActions}>
                            <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "change_plan" })}>
                              Change plan
                            </Button>
                            {sub.status === "TRIAL" && (
                              <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "extend_trial" })}>
                                Extend trial
                              </Button>
                            )}
                            {(sub.status === "CANCELLED" || sub.status === "EXPIRED") && (
                              <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "start_trial" })}>
                                Start trial
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className={styles.sectionGap}>
                        <span className={styles.muted}>No subscription: global default limits apply.</span>
                        {can(PLATFORM_PERMISSIONS.SUBSCRIPTION_MANAGE) && (
                          <div className={styles.inlineActions}>
                            <Button size="sm" onClick={() => setDialog({ kind: "change_plan" })}>
                              Subscribe to a plan
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "start_trial" })}>
                              Start trial
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </BentoCard>
                  <BentoCard
                    span={6}
                    title="Add-ons"
                    subtitle="Complimentary grants raise a limit until they end or are revoked"
                    action={
                      can(PLATFORM_PERMISSIONS.ENTITLEMENT_MANAGE) && can(PLATFORM_PERMISSIONS.PLAN_READ) ? (
                        <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "grant_addon" })}>
                          Grant add-on
                        </Button>
                      ) : undefined
                    }
                  >
                    {can(PLATFORM_PERMISSIONS.ENTITLEMENT_READ) ? (
                      <ResourceView
                        state={grants.state}
                        onRetry={grants.reload}
                        resource="add-ons"
                        emptyFigure="empty-list"
                        emptyTitle="No add-ons"
                        emptyDescription="Grants appear here with their start, end and the limit they raise."
                        renderReady={(rows) => (
                          <ul className={styles.list}>
                            {rows.map((g) => (
                              <li key={g.id} className={styles.listRow}>
                                <span className={styles.rowMain}>
                                  <span className={styles.rowTitle}>
                                    {g.addon_name ?? g.addon_id} × {g.quantity}
                                  </span>
                                  <span className={styles.rowMeta}>
                                    +{formatCount(g.increment_total)} {g.entitlement_id ? findEntitlementSpec(g.entitlement_id)?.label ?? g.entitlement_id : ""} ·{" "}
                                    {humanize(g.source)} · {g.ends_at ? `until ${formatDateTime(g.ends_at)}` : "no end"}
                                  </span>
                                </span>
                                <span className={styles.inlineActions}>
                                  <StatusPill status={g.revoked_at ? "CANCELLED" : g.active ? "ACTIVE" : "EXPIRED"} label={g.revoked_at ? "Revoked" : g.active ? "Active" : "Not active"} />
                                  {!g.revoked_at && can(PLATFORM_PERMISSIONS.ENTITLEMENT_MANAGE) && (
                                    <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "revoke_addon", grant: g })}>
                                      Revoke
                                    </Button>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      />
                    ) : (
                      <PermissionDenied resource="add-ons" requiredPermission={PLATFORM_PERMISSIONS.ENTITLEMENT_READ} inline />
                    )}
                  </BentoCard>
                </BentoGrid>
              )}

              {tab === "support" && (
                <BentoCard span={12} title="Support sessions" subtitle="Read-only views of this workspace by platform operators">
                  <ResourceView
                    state={sessions.state.kind === "ready" && tenantSessions.length === 0 ? { kind: "empty", fetchedAt: sessions.state.fetchedAt } : sessions.state}
                    onRetry={sessions.reload}
                    resource="support sessions"
                    emptyFigure="log-empty"
                    emptyTitle="No support sessions"
                    emptyDescription="Sessions started for this workspace appear here with their reason and expiry."
                    renderReady={() => (
                      <div className={styles.tableWrap}>
                        <table className={styles.table}>
                          <thead>
                            <tr>
                              <th>Started</th>
                              <th>Operator</th>
                              <th>Mode</th>
                              <th>Reason</th>
                              <th>Ends</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {tenantSessions.map((s) => {
                              const live = !s.revoked_at && Date.parse(s.expires_at) > Date.now();
                              return (
                                <tr key={s.id}>
                                  <td>{formatDateTime(s.created_at)}</td>
                                  <td className={styles.mono}>{s.operator_user_id}</td>
                                  <td>{humanize(s.mode)}</td>
                                  <td>{s.reason}</td>
                                  <td>{s.revoked_at ? `Ended ${formatDateTime(s.revoked_at)}` : live ? formatCountdown(s.expires_at) : "Expired"}</td>
                                  <td>
                                    {live && can(PLATFORM_PERMISSIONS.SUPPORT_IMPERSONATE) && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={async () => {
                                          await platformRequest(
                                            `/api/v1/platform/support/impersonate?sessionId=${encodeURIComponent(s.id)}&reason=${encodeURIComponent("Ended from Tenant 360")}`,
                                            { method: "DELETE" }
                                          ).catch(() => undefined);
                                          sessions.reload();
                                        }}
                                      >
                                        End
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

              {tab === "audit" && (
                <BentoCard span={12} title="Audit" subtitle="Platform actions on this tenant">
                  <ResourceView
                    state={audit.state}
                    onRetry={audit.reload}
                    resource="the audit log"
                    emptyFigure="log-empty"
                    emptyTitle="No platform actions on this tenant"
                    emptyDescription="Suspensions, plan changes, overrides and support sessions appear here."
                    renderReady={(logs) => (
                      <div className={styles.tableWrap}>
                        <table className={styles.table}>
                          <thead>
                            <tr>
                              <th>When</th>
                              <th>Action</th>
                              <th>Reason</th>
                              <th>Role</th>
                              <th>Result</th>
                            </tr>
                          </thead>
                          <tbody>
                            {logs.map((l) => (
                              <tr key={l.id}>
                                <td>{formatDateTime(l.created_at)}</td>
                                <td className={styles.mono}>{l.action}</td>
                                <td>{l.reason}</td>
                                <td>{humanize(l.platform_role)}</td>
                                <td>
                                  <StatusPill status={l.result} />
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

              {/* ---------- Dialogs ---------- */}
              <TenantDialogs
                dialog={dialog}
                onClose={() => setDialog(null)}
                tenant={t}
                subscription={sub}
                post={post}
                base={base!}
                plans={plans.state.kind === "ready" ? plans.state.data : []}
                addons={addonCatalog.state.kind === "ready" ? addonCatalog.state.data.filter((a) => a.status === "ACTIVE") : []}
                inputs={{
                  overrideValue,
                  setOverrideValue,
                  overrideUnlimited,
                  setOverrideUnlimited,
                  overrideExpiry,
                  setOverrideExpiry,
                  planChoice,
                  setPlanChoice,
                  periodChoice,
                  setPeriodChoice,
                  endTrial,
                  setEndTrial,
                  trialEnd,
                  setTrialEnd,
                  addonChoice,
                  setAddonChoice,
                  addonQty,
                  setAddonQty,
                  addonEnds,
                  setAddonEnds,
                  supportMinutes,
                  setSupportMinutes,
                }}
                done={done}
              />
            </>
          );
        }}
      />
    </>
  );
}

interface DialogInputs {
  overrideValue: string;
  setOverrideValue: (v: string) => void;
  overrideUnlimited: boolean;
  setOverrideUnlimited: (v: boolean) => void;
  overrideExpiry: string;
  setOverrideExpiry: (v: string) => void;
  planChoice: string;
  setPlanChoice: (v: string) => void;
  periodChoice: "" | "MONTHLY" | "ANNUAL";
  setPeriodChoice: (v: "" | "MONTHLY" | "ANNUAL") => void;
  endTrial: boolean;
  setEndTrial: (v: boolean) => void;
  trialEnd: string;
  setTrialEnd: (v: string) => void;
  addonChoice: string;
  setAddonChoice: (v: string) => void;
  addonQty: string;
  setAddonQty: (v: string) => void;
  addonEnds: string;
  setAddonEnds: (v: string) => void;
  supportMinutes: string;
  setSupportMinutes: (v: string) => void;
}

/** datetime-local value → ISO string, or undefined when empty/invalid. */
function localToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function TenantDialogs({
  dialog,
  onClose,
  tenant,
  subscription,
  post,
  base,
  plans,
  addons,
  inputs: i,
  done,
}: {
  dialog: DialogState;
  onClose: () => void;
  tenant: TenantDetail["tenant"];
  subscription: TenantDetail["subscription"];
  post: (path: string, json: unknown, stepUp: string | null) => Promise<unknown>;
  base: string;
  plans: PlanView[];
  addons: AddonView[];
  inputs: DialogInputs;
  done: (message: string) => () => void;
}) {
  const target = { type: "tenant" as const, id: tenant.id, label: tenant.name, slug: tenant.slug };
  const open = (k: string) => dialog?.kind === k;
  const sellable = plans.filter((p) => p.current_version);
  const chosenPlan = sellable.find((p) => p.id === i.planChoice);

  return (
    <>
      <PrivilegedActionDialog
        open={open("suspend")}
        onClose={onClose}
        actionKey="tenant.suspend"
        target={target}
        impact={{ target: tenant.id }}
        execute={(a: ExecuteArgs) =>
          post("/suspend", { reason: a.reason, ...(a.ticketRef ? { ticket_ref: a.ticketRef } : {}), ...(a.approvalId ? { approval_id: a.approvalId } : {}) }, a.stepUpToken)
        }
        onDone={done(`${tenant.name} is suspended.`)}
      />
      <PrivilegedActionDialog
        open={open("activate")}
        onClose={onClose}
        actionKey="tenant.activate"
        target={target}
        execute={(a) => post("/activate", { reason: a.reason }, a.stepUpToken)}
        onDone={done(`${tenant.name} is active again.`)}
      />
      <PrivilegedActionDialog
        open={open("archive")}
        onClose={onClose}
        actionKey="tenant.archive"
        target={target}
        impact={{ target: tenant.id }}
        execute={(a) =>
          platformRequest(base, { method: "DELETE", json: { reason: a.reason, ...(a.ticketRef ? { ticket_ref: a.ticketRef } : {}), ...(a.approvalId ? { approval_id: a.approvalId } : {}) } }, a.stepUpToken).then((r) => r.data)
        }
        onDone={done(`${tenant.name} is archived.`)}
      />
      <PrivilegedActionDialog
        open={open("purge")}
        onClose={onClose}
        actionKey="tenant.purge"
        target={target}
        impact={{ target: tenant.id }}
        execute={(a) =>
          post(
            "/purge",
            {
              reason: a.reason,
              ...(a.ticketRef ? { ticket_ref: a.ticketRef } : {}),
              ...(a.approvalId ? { approval_id: a.approvalId } : {}),
              ...(a.confirmation ? { confirmation: a.confirmation } : {}),
            },
            a.stepUpToken
          )
        }
        onDone={done(`Purge scheduled for ${tenant.name}. Data is kept for 14 days; nothing has been deleted.`)}
      />
      <PrivilegedActionDialog
        open={open("purge_cancel")}
        onClose={onClose}
        actionKey="tenant.purge_cancel"
        target={target}
        execute={(a) =>
          platformRequest(`${base}/purge`, { method: "DELETE", json: { reason: a.reason, ...(a.ticketRef ? { ticket_ref: a.ticketRef } : {}) } }, a.stepUpToken).then((r) => r.data)
        }
        onDone={done("The scheduled purge is cancelled.")}
      />

      {dialog?.kind === "override" && (
        <PrivilegedActionDialog
          open
          onClose={onClose}
          actionKey="entitlement.override"
          target={{ type: "entitlement", id: `${tenant.id}:${dialog.ent.id}`, label: `${tenant.name} · ${dialog.ent.label}` }}
          canSubmit={dialog.ent.kind === "FEATURE" ? i.overrideValue === "true" || i.overrideValue === "false" : i.overrideUnlimited || /^\d+$/.test(i.overrideValue)}
          execute={(a) =>
            post(
              "/entitlements",
              {
                action: "SET_OVERRIDE",
                entitlement_id: dialog.ent.id,
                value: dialog.ent.kind === "FEATURE" ? i.overrideValue === "true" : i.overrideUnlimited ? null : Number(i.overrideValue),
                reason: a.reason,
                ...(localToIso(i.overrideExpiry) ? { expires_at: localToIso(i.overrideExpiry) } : {}),
                ...(a.ticketRef ? { ticket_ref: a.ticketRef } : {}),
              },
              a.stepUpToken
            )
          }
          onDone={done(`${dialog.ent.label} override saved.`)}
        >
          <span className={styles.hint}>
            In force now: {valueLabel(dialog.ent)} ({humanize(dialog.ent.source)}). An override replaces the plan value and add-ons.
          </span>
          {dialog.ent.kind === "FEATURE" ? (
            <label className={styles.field}>
              Value
              <select className={styles.select} value={i.overrideValue} onChange={(e) => i.setOverrideValue(e.target.value)}>
                <option value="">Choose</option>
                <option value="true">On</option>
                <option value="false">Off</option>
              </select>
            </label>
          ) : (
            <>
              <label className={styles.field}>
                New limit {dialog.ent.unit ? `(${dialog.ent.unit})` : ""}
                <input
                  className={styles.input}
                  inputMode="numeric"
                  value={i.overrideValue}
                  disabled={i.overrideUnlimited}
                  onChange={(e) => i.setOverrideValue(e.target.value.replace(/\D/g, ""))}
                />
              </label>
              {findEntitlementSpec(dialog.ent.id)?.allowUnlimited && (
                <label className={styles.field}>
                  <span>
                    <input type="checkbox" checked={i.overrideUnlimited} onChange={(e) => i.setOverrideUnlimited(e.target.checked)} /> Unlimited
                  </span>
                </label>
              )}
            </>
          )}
          <label className={styles.field}>
            Expires (optional)
            <span className={styles.hint}>After this the plan value applies again, without anyone having to remember.</span>
            <input className={styles.input} type="datetime-local" value={i.overrideExpiry} onChange={(e) => i.setOverrideExpiry(e.target.value)} />
          </label>
        </PrivilegedActionDialog>
      )}

      {dialog?.kind === "clear_override" && (
        <PrivilegedActionDialog
          open
          onClose={onClose}
          actionKey="entitlement.clear_override"
          target={{ type: "entitlement", id: `${tenant.id}:${dialog.ent.id}`, label: `${tenant.name} · ${dialog.ent.label}` }}
          execute={(a) => post("/entitlements", { action: "CLEAR_OVERRIDE", entitlement_id: dialog.ent.id, reason: a.reason }, a.stepUpToken)}
          onDone={done(`${dialog.ent.label} override removed.`)}
        />
      )}

      <PrivilegedActionDialog
        open={open("change_plan")}
        onClose={onClose}
        actionKey="subscription.change_plan"
        target={target}
        canSubmit={Boolean(chosenPlan)}
        execute={(a) =>
          post(
            "/subscription",
            {
              action: "CHANGE_PLAN",
              plan_id: i.planChoice,
              ...(i.periodChoice ? { billing_period: i.periodChoice } : {}),
              ...(subscription?.status === "TRIAL" ? { end_trial: i.endTrial } : {}),
              reason: a.reason,
            },
            a.stepUpToken
          )
        }
        onDone={done("Plan changed.")}
      >
        <label className={styles.field}>
          Plan
          <select className={styles.select} value={i.planChoice} onChange={(e) => i.setPlanChoice(e.target.value)}>
            <option value="">Choose a plan</option>
            {sellable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} v{p.current_version?.version}
              </option>
            ))}
          </select>
        </label>
        {chosenPlan?.current_version && (
          <label className={styles.field}>
            Billing period
            <select className={styles.select} value={i.periodChoice} onChange={(e) => i.setPeriodChoice(e.target.value as "" | "MONTHLY" | "ANNUAL")}>
              <option value="">Default for the version</option>
              {chosenPlan.current_version.monthly_price !== null && <option value="MONTHLY">Monthly</option>}
              {chosenPlan.current_version.annual_price !== null && <option value="ANNUAL">Annual</option>}
            </select>
          </label>
        )}
        {subscription?.status === "TRIAL" && (
          <label className={styles.field}>
            <span>
              <input type="checkbox" checked={i.endTrial} onChange={(e) => i.setEndTrial(e.target.checked)} /> End the trial now (becomes active)
            </span>
          </label>
        )}
      </PrivilegedActionDialog>

      <PrivilegedActionDialog
        open={open("start_trial")}
        onClose={onClose}
        actionKey="subscription.change_plan"
        submitLabel="Start trial"
        target={target}
        canSubmit={Boolean(chosenPlan)}
        execute={(a) => post("/subscription", { action: "START_TRIAL", plan_id: i.planChoice, reason: a.reason }, a.stepUpToken)}
        onDone={done("Trial started.")}
      >
        <label className={styles.field}>
          Plan
          <select className={styles.select} value={i.planChoice} onChange={(e) => i.setPlanChoice(e.target.value)}>
            <option value="">Choose a plan</option>
            {sellable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} v{p.current_version?.version}
                {p.current_version?.trial_days ? ` · ${p.current_version.trial_days}-day trial` : ""}
              </option>
            ))}
          </select>
        </label>
      </PrivilegedActionDialog>

      <PrivilegedActionDialog
        open={open("extend_trial")}
        onClose={onClose}
        actionKey="subscription.extend_trial"
        target={target}
        canSubmit={Boolean(localToIso(i.trialEnd))}
        execute={(a) => post("/subscription", { action: "EXTEND_TRIAL", trial_ends_at: localToIso(i.trialEnd), reason: a.reason }, a.stepUpToken)}
        onDone={done("Trial extended.")}
      >
        <span className={styles.hint}>Current trial end: {formatDateTime(subscription?.trial_ends_at)}.</span>
        <label className={styles.field}>
          New trial end
          <input className={styles.input} type="datetime-local" value={i.trialEnd} onChange={(e) => i.setTrialEnd(e.target.value)} />
        </label>
      </PrivilegedActionDialog>

      <PrivilegedActionDialog
        open={open("grant_addon")}
        onClose={onClose}
        actionKey="addon.grant"
        target={target}
        canSubmit={Boolean(i.addonChoice) && /^\d+$/.test(i.addonQty) && Number(i.addonQty) >= 1}
        execute={(a) =>
          post(
            "/addons",
            {
              action: "GRANT",
              addon_id: i.addonChoice,
              quantity: Number(i.addonQty),
              ...(localToIso(i.addonEnds) ? { ends_at: localToIso(i.addonEnds) } : {}),
              reason: a.reason,
              ...(a.ticketRef ? { ticket_ref: a.ticketRef } : {}),
            },
            a.stepUpToken
          )
        }
        onDone={done("Add-on granted.")}
      >
        {addons.length === 0 ? (
          <span className={styles.hint}>No active add-ons exist. Create one in Plans & Billing → Add-ons.</span>
        ) : (
          <>
            <label className={styles.field}>
              Add-on
              <select className={styles.select} value={i.addonChoice} onChange={(e) => i.setAddonChoice(e.target.value)}>
                <option value="">Choose an add-on</option>
                {addons.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} (+{formatCount(a.increment)} {a.entitlement_label})
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              Quantity
              <input className={styles.input} inputMode="numeric" value={i.addonQty} onChange={(e) => i.setAddonQty(e.target.value.replace(/\D/g, ""))} />
            </label>
            <label className={styles.field}>
              Ends (optional)
              <input className={styles.input} type="datetime-local" value={i.addonEnds} onChange={(e) => i.setAddonEnds(e.target.value)} />
            </label>
            <span className={styles.hint}>Granted as complimentary: the billing engine that would charge for add-ons isn&apos;t built yet.</span>
          </>
        )}
      </PrivilegedActionDialog>

      {dialog?.kind === "revoke_addon" && (
        <PrivilegedActionDialog
          open
          onClose={onClose}
          actionKey="addon.revoke"
          target={target}
          execute={(a) => post("/addons", { action: "REVOKE", grant_id: dialog.grant.id, reason: a.reason }, a.stepUpToken)}
          onDone={done("Add-on revoked.")}
        >
          <span className={styles.hint}>
            Revoking {dialog.grant.addon_name ?? dialog.grant.addon_id} × {dialog.grant.quantity} lowers the limit immediately.
          </span>
        </PrivilegedActionDialog>
      )}

      <PrivilegedActionDialog
        open={open("support")}
        onClose={onClose}
        actionKey="support.impersonate"
        target={target}
        submitLabel="Start read-only session"
        canSubmit={/^\d+$/.test(i.supportMinutes) && Number(i.supportMinutes) >= 5 && Number(i.supportMinutes) <= 120}
        execute={(a) =>
          platformRequest(
            "/api/v1/platform/support/impersonate",
            {
              method: "POST",
              json: {
                tenant_id: tenant.id,
                reason: a.reason,
                ...(a.ticketRef ? { ticket_id: a.ticketRef } : {}),
                mode: "READ_ONLY",
                duration_minutes: Number(i.supportMinutes),
              },
            },
            a.stepUpToken
          ).then((r) => r.data)
        }
        onDone={done("Support session started. Open the workspace at / in this browser; the banner there ends it.")}
      >
        <label className={styles.field}>
          Duration (minutes, 5–120)
          <input className={styles.input} inputMode="numeric" value={i.supportMinutes} onChange={(e) => i.setSupportMinutes(e.target.value.replace(/\D/g, ""))} />
        </label>
        <span className={styles.hint}>Read-only: the workspace owner&apos;s view with every change refused. Each request is logged.</span>
      </PrivilegedActionDialog>
    </>
  );
}
