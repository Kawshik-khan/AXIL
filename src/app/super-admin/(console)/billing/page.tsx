"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, RefreshCw } from "lucide-react";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { PLATFORM_PERMISSIONS } from "@/lib/permissions";
import { ENTITLEMENT_CATALOG } from "@/domains/platform/entitlement-catalog";
import type { PlanView } from "@/domains/platform/services/platform-plan.service";
import type { MigrationImpact } from "@/domains/platform/services/platform-plan.service";
import type { AddonView } from "@/domains/platform/services/platform-addon.service";
import type { PlatformOverviewMetrics } from "@/domains/platform/services/platform-analytics.service";
import { usePlatformResource } from "../../_lib/use-platform-resource";
import { usePlatformSession } from "../../_lib/platform-session";
import { PlatformApiError, platformRequest } from "../../_lib/platform-client";
import { formatCount, formatDateTime, formatMoney, humanize, NO_DATA } from "../../_lib/format";
import { CONSOLE_ROOT } from "../../_lib/platform-module-access";
import { PageHeader } from "../../_components/PageHeader";
import { ResourceView } from "../../_components/ResourceView";
import { StatusPill } from "../../_components/StatusPill";
import { Tabs, useTab, type TabDef } from "../../_components/Tabs";
import { PrivilegedActionDialog } from "../../_components/PrivilegedActionDialog";
import { PlanEditor } from "./PlanEditor";
import styles from "../../super-admin.module.css";

type TabId = "plans" | "catalog" | "addons" | "subscriptions" | "migrate";

interface CatalogRow {
  id: string;
  label: string;
  description: string;
  kind: string;
  unit?: string;
  enforced: boolean;
  enforcedBy: string | null;
  default_value: unknown;
  has_default: boolean;
}

interface SubscriptionRow {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
  plan_id: string;
  plan_name: string | null;
  plan_version: number | null;
  status: string;
  billing_period: string | null;
  current_period_end: string;
  trial_ends_at?: string;
  mrr_bdt: number;
}

type Dialog =
  | { kind: "create_plan" }
  | { kind: "edit_plan"; plan: PlanView }
  | { kind: "publish" | "retire"; plan: PlanView; versionId: string; version: number }
  | { kind: "create_addon" }
  | { kind: "retire_addon"; addon: AddonView }
  | { kind: "migrate" }
  | null;

export default function BillingPage() {
  const { can } = usePlatformSession();
  const tabs: TabDef<TabId>[] = [
    { id: "plans", label: "Plans" },
    { id: "catalog", label: "Entitlement catalog", visible: can(PLATFORM_PERMISSIONS.ENTITLEMENT_READ) },
    { id: "addons", label: "Add-ons" },
    { id: "subscriptions", label: "Subscriptions", visible: can(PLATFORM_PERMISSIONS.SUBSCRIPTION_READ) },
    { id: "migrate", label: "Move tenants", visible: can(PLATFORM_PERMISSIONS.SUBSCRIPTION_READ) },
  ];
  const [tab, setTab] = useTab(tabs, "plans");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const plans = usePlatformResource<PlanView[]>("/api/v1/platform/plans", { isEmpty: (p) => p.length === 0 });
  const overview = usePlatformResource<PlatformOverviewMetrics>(can(PLATFORM_PERMISSIONS.PLATFORM_READ) ? "/api/v1/platform/overview" : null);
  const catalog = usePlatformResource<CatalogRow[]>(tab === "catalog" ? "/api/v1/platform/entitlements" : null);
  const addons = usePlatformResource<AddonView[]>(tab === "addons" ? "/api/v1/platform/addons" : null, { isEmpty: (a) => a.length === 0 });
  const subs = usePlatformResource<SubscriptionRow[]>(tab === "subscriptions" ? "/api/v1/platform/subscriptions" : null, { isEmpty: (s) => s.length === 0 });

  const planList = plans.state.kind === "ready" ? plans.state.data : [];
  const active = planList.find((p) => p.id === selectedPlan) ?? planList[0] ?? null;

  const done = (msg: string) => () => {
    setNotice(msg);
    plans.reload();
    addons.reload();
    subs.reload();
  };

  // Plan create/edit inputs
  const [planForm, setPlanForm] = useState({ id: "", name: "", description: "", visibility: "HIDDEN", display_order: "", highlight_label: "" });
  // Add-on inputs
  const [addonForm, setAddonForm] = useState({ name: "", description: "", entitlement_id: "", increment: "", allowed: [] as string[] });
  // Migration inputs
  const [fromVersion, setFromVersion] = useState("");
  const [toVersion, setToVersion] = useState("");
  const [impact, setImpact] = useState<MigrationImpact | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);

  const allVersions = useMemo(
    () => planList.flatMap((p) => p.versions.map((v) => ({ plan: p, version: v }))),
    [planList]
  );

  useEffect(() => {
    setImpact(null);
    setImpactError(null);
    if (!fromVersion || !toVersion || fromVersion === toVersion) return;
    const q = new URLSearchParams({ from_version_id: fromVersion, to_version_id: toVersion });
    platformRequest<MigrationImpact>(`/api/v1/platform/plans/impact?${q.toString()}`)
      .then((r) => setImpact(r.data))
      .catch((err: unknown) => setImpactError(err instanceof PlatformApiError ? err.message : "Impact could not be computed."));
  }, [fromVersion, toVersion]);

  const financials = overview.state.kind === "ready" ? overview.state.data.financials : null;

  return (
    <>
      <PageHeader
        title="Plans & Billing"
        description="Customize plans, limits and add-ons. Only limits the platform enforces can be set; published versions never change."
        fetchedAt={plans.state.kind === "ready" ? plans.state.fetchedAt : undefined}
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={() => { plans.reload(); overview.reload(); }}>
              Refresh
            </Button>
            {can(PLATFORM_PERMISSIONS.PLAN_CREATE) && (
              <Button size="sm" icon={<Plus size={14} />} onClick={() => setDialog({ kind: "create_plan" })}>
                New plan
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

      {financials && (
        <BentoGrid>
          <BentoCard span={4}>
            <div className={styles.kpiLabel}>Monthly recurring revenue</div>
            <div className={financials.active_subscriptions_count > 0 ? styles.kpiValue : styles.kpiValueMuted}>
              {financials.active_subscriptions_count > 0 ? formatMoney(financials.mrr_bdt, financials.currency) : NO_DATA}
            </div>
            <div className={styles.kpiSub}>Annual plans count annual price ÷ 12</div>
          </BentoCard>
          <BentoCard span={4}>
            <div className={styles.kpiLabel}>Active subscriptions</div>
            <div className={styles.kpiValue}>{formatCount(financials.active_subscriptions_count)}</div>
          </BentoCard>
          <BentoCard span={4}>
            <div className={styles.kpiLabel}>Average revenue per subscription</div>
            <div className={financials.active_subscriptions_count > 0 ? styles.kpiValue : styles.kpiValueMuted}>
              {financials.active_subscriptions_count > 0 ? formatMoney(financials.arpu_bdt, financials.currency) : NO_DATA}
            </div>
          </BentoCard>
        </BentoGrid>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "plans" && (
        <ResourceView
          state={plans.state}
          onRetry={plans.reload}
          resource="plans"
          emptyFigure="empty-list"
          emptyTitle="No plans yet"
          emptyDescription="Create a plan, set its prices and limits in a draft, then publish it."
          emptyActionText={can(PLATFORM_PERMISSIONS.PLAN_CREATE) ? "New plan" : undefined}
          onEmptyAction={() => setDialog({ kind: "create_plan" })}
          renderReady={(list) => (
            <BentoGrid>
              <BentoCard span={4} title="Plans" subtitle="Ordered as shown to merchants">
                <ul className={styles.list}>
                  {list.map((p) => (
                    <li key={p.id} className={styles.listRow}>
                      <button
                        type="button"
                        className={`${styles.rowMain} ${styles.rowLink} ${styles.linkButton}`}
                        onClick={() => setSelectedPlan(p.id)}
                        aria-pressed={active?.id === p.id}
                      >
                        <span className={styles.rowTitle}>
                          {p.name}
                          {active?.id === p.id ? " ←" : ""}
                        </span>
                        <span className={styles.rowMeta}>
                          {p.id} · {humanize(p.effective_visibility)} · {formatCount(p.subscriber_count)} subscribers
                        </span>
                      </button>
                      {p.current_version ? <StatusPill status="PUBLISHED" label={`v${p.current_version.version}`} /> : <StatusPill status="DRAFT" label="Not sellable" />}
                    </li>
                  ))}
                </ul>
              </BentoCard>

              {active && (
                <BentoCard
                  span={8}
                  title={active.name}
                  subtitle={`${active.description || "No description"} · MRR ${formatMoney(active.mrr_bdt, "BDT")}`}
                  action={
                    can(PLATFORM_PERMISSIONS.PLAN_UPDATE) ? (
                      <Button size="sm" variant="outline" onClick={() => {
                        setPlanForm({
                          id: active.id,
                          name: active.name,
                          description: active.description,
                          visibility: active.effective_visibility,
                          display_order: active.display_order !== undefined ? String(active.display_order) : "",
                          highlight_label: active.highlight_label ?? "",
                        });
                        setDialog({ kind: "edit_plan", plan: active });
                      }}>
                        Edit details
                      </Button>
                    ) : undefined
                  }
                >
                  <div className={styles.sectionGap}>
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Version</th>
                            <th>Status</th>
                            <th>Monthly</th>
                            <th>Annual</th>
                            <th className={styles.numeric}>Subscribers</th>
                            <th>Note</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {active.versions.map((v) => (
                            <tr key={v.id}>
                              <td>v{v.version}</td>
                              <td>
                                <StatusPill status={v.effective_status} />
                              </td>
                              <td>{v.monthly_price === null ? "—" : formatMoney(v.monthly_price, "BDT")}</td>
                              <td>{v.annual_price === null ? "—" : formatMoney(v.annual_price, "BDT")}</td>
                              <td className={styles.numeric}>{formatCount(v.subscriber_count)}</td>
                              <td>{v.change_note ?? (v.published_at ? `Published ${formatDateTime(v.published_at)}` : "")}</td>
                              <td>
                                {can(PLATFORM_PERMISSIONS.PLAN_UPDATE) && v.effective_status === "DRAFT" && (
                                  <Button size="sm" onClick={() => setDialog({ kind: "publish", plan: active, versionId: v.id, version: v.version })}>
                                    Publish
                                  </Button>
                                )}
                                {can(PLATFORM_PERMISSIONS.PLAN_UPDATE) && v.effective_status === "PUBLISHED" && (
                                  <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "retire", plan: active, versionId: v.id, version: v.version })}>
                                    Retire
                                  </Button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <PlanEditor plan={active} canEdit={can(PLATFORM_PERMISSIONS.PLAN_UPDATE)} onSaved={plans.reload} />
                  </div>
                </BentoCard>
              )}
            </BentoGrid>
          )}
        />
      )}

      {tab === "catalog" && (
        <BentoCard span={12} title="Entitlement catalog" subtitle="What plans can limit. A new kind of limit needs its counter and gate built first.">
          <ResourceView
            state={catalog.state}
            onRetry={catalog.reload}
            resource="the entitlement catalog"
            emptyFigure="no-data"
            emptyTitle="Empty catalog"
            emptyDescription="No entitlements are declared."
            renderReady={(rows) => (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Entitlement</th>
                      <th>Kind</th>
                      <th>Global default</th>
                      <th>Enforced by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <span className={styles.rowMain}>
                            <span className={styles.rowTitle}>{r.label}</span>
                            <span className={styles.rowMeta}>
                              <code>{r.id}</code> · {r.description}
                            </span>
                          </span>
                        </td>
                        <td>{humanize(r.kind)}</td>
                        <td>{r.has_default ? String(r.default_value) : "Not gated"}</td>
                        <td>{r.enforced ? <span className={styles.mono}>{r.enforcedBy}</span> : <StatusPill status="SIMULATED" label="Not enforced yet" />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          />
        </BentoCard>
      )}

      {tab === "addons" && (
        <BentoCard
          span={12}
          title="Add-ons"
          subtitle="Raise one enforced limit per unit. Granted free of charge until the billing engine exists."
          action={
            can(PLATFORM_PERMISSIONS.PLAN_CREATE) ? (
              <Button size="sm" icon={<Plus size={14} />} onClick={() => setDialog({ kind: "create_addon" })}>
                New add-on
              </Button>
            ) : undefined
          }
        >
          <ResourceView
            state={addons.state}
            onRetry={addons.reload}
            resource="add-ons"
            emptyFigure="empty-list"
            emptyTitle="No add-ons yet"
            emptyDescription="Create one, e.g. +5 staff users, then grant it from a tenant's Commercial tab."
            renderReady={(rows) => (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Add-on</th>
                      <th>Raises</th>
                      <th>Plans</th>
                      <th className={styles.numeric}>Active grants</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <span className={styles.rowMain}>
                            <span className={styles.rowTitle}>{a.name}</span>
                            <span className={styles.rowMeta}>{a.description}</span>
                          </span>
                        </td>
                        <td>
                          +{formatCount(a.increment)} {a.entitlement_label}
                        </td>
                        <td>{a.allowed_plan_ids.length ? a.allowed_plan_ids.join(", ") : "Any plan"}</td>
                        <td className={styles.numeric}>{formatCount(a.active_grants)}</td>
                        <td>
                          <StatusPill status={a.status} />
                        </td>
                        <td>
                          {a.status === "ACTIVE" && can(PLATFORM_PERMISSIONS.PLAN_UPDATE) && (
                            <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "retire_addon", addon: a })}>
                              Retire
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

      {tab === "subscriptions" && (
        <BentoCard span={12} title="Subscriptions" subtitle="Change a tenant's plan or trial from its Commercial tab">
          <ResourceView
            state={subs.state}
            onRetry={subs.reload}
            resource="subscriptions"
            emptyFigure="empty-list"
            emptyTitle="No subscriptions"
            emptyDescription="Subscriptions appear when tenants are provisioned or moved onto a plan."
            renderReady={(rows) => (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Tenant</th>
                      <th>Plan</th>
                      <th>Status</th>
                      <th>Period</th>
                      <th>Renews / ends</th>
                      <th className={styles.numeric}>MRR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <Link href={`${CONSOLE_ROOT}/tenants/${encodeURIComponent(s.tenant_id)}?tab=commercial`}>{s.tenant_name ?? s.tenant_id}</Link>
                        </td>
                        <td>
                          {s.plan_name ?? s.plan_id}
                          {s.plan_version ? ` v${s.plan_version}` : ""}
                        </td>
                        <td>
                          <StatusPill status={s.status} />
                        </td>
                        <td>{s.billing_period ? humanize(s.billing_period) : "—"}</td>
                        <td>{formatDateTime(s.trial_ends_at ?? s.current_period_end)}</td>
                        <td className={styles.numeric}>{formatMoney(s.mrr_bdt, "BDT")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          />
        </BentoCard>
      )}

      {tab === "migrate" && (
        <BentoCard span={12} title="Move tenants between plan versions" subtitle="Preview counts current usage against the new limits before anything moves">
          <div className={styles.sectionGap}>
            <div className={styles.toolbar}>
              <select className={styles.select} value={fromVersion} onChange={(e) => setFromVersion(e.target.value)} aria-label="From version">
                <option value="">From version…</option>
                {allVersions
                  .filter(({ version }) => version.subscriber_count > 0)
                  .map(({ plan, version }) => (
                    <option key={version.id} value={version.id}>
                      {plan.name} v{version.version} ({formatCount(version.subscriber_count)} subscribers)
                    </option>
                  ))}
              </select>
              <select className={styles.select} value={toVersion} onChange={(e) => setToVersion(e.target.value)} aria-label="To version">
                <option value="">To published version…</option>
                {allVersions
                  .filter(({ version }) => version.effective_status === "PUBLISHED" && version.id !== fromVersion)
                  .map(({ plan, version }) => (
                    <option key={version.id} value={version.id}>
                      {plan.name} v{version.version}
                    </option>
                  ))}
              </select>
            </div>
            {impactError && <span className={styles.fieldError}>{impactError}</span>}
            {impact && (
              <>
                <dl className={styles.definition}>
                  <dt>Tenants that move</dt>
                  <dd>{formatCount(impact.affected_tenants)}</dd>
                  <dt>MRR</dt>
                  <dd>
                    {formatMoney(impact.mrr_before_bdt, "BDT")} → {formatMoney(impact.mrr_after_bdt, "BDT")}
                  </dd>
                  <dt>Second operator</dt>
                  <dd>{impact.approval_required ? `Required (more than ${formatCount(impact.approval_threshold)} tenants)` : "Not required"}</dd>
                </dl>
                {impact.lowered_limits.length > 0 ? (
                  <div className={styles.dangerZone}>
                    <strong>Lowered limits</strong>
                    <span className={styles.hint}>Tenants above a new limit keep their data; new additions are blocked until they are under it.</span>
                    <ul className={styles.list}>
                      {impact.lowered_limits.map((l) => (
                        <li key={l.id} className={styles.listRow}>
                          <span>
                            {l.label}: {l.from === null ? "unlimited" : String(l.from)} → {String(l.to)}
                          </span>
                          <span className={styles.mono}>{formatCount(l.tenants_above_new_limit)} tenants already above</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <span className={styles.hint}>No limit is lowered by this move.</span>
                )}
                {can(PLATFORM_PERMISSIONS.SUBSCRIPTION_MANAGE) && impact.affected_tenants > 0 && (
                  <div className={styles.inlineActions}>
                    <Button variant="danger" size="sm" onClick={() => setDialog({ kind: "migrate" })}>
                      Move {formatCount(impact.affected_tenants)} tenants
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </BentoCard>
      )}

      {/* ---------- Dialogs ---------- */}
      <PrivilegedActionDialog
        open={dialog?.kind === "create_plan"}
        onClose={() => setDialog(null)}
        actionKey="plan.create"
        target={{ type: "platform", id: planForm.id || "new-plan", label: planForm.name || "New plan" }}
        canSubmit={/^[A-Za-z][A-Za-z0-9_]{1,39}$/.test(planForm.id) && planForm.name.trim().length >= 2}
        execute={async (a) =>
          (
            await platformRequest("/api/v1/platform/plans", {
              method: "POST",
              json: {
                id: planForm.id.toUpperCase(),
                name: planForm.name.trim(),
                description: planForm.description.trim(),
                visibility: planForm.visibility,
                ...(planForm.display_order ? { display_order: Number(planForm.display_order) } : {}),
                ...(planForm.highlight_label.trim() ? { highlight_label: planForm.highlight_label.trim() } : {}),
                reason: a.reason,
              },
            })
          ).data
        }
        onDone={() => {
          setSelectedPlan(planForm.id.toUpperCase());
          done("Plan created with an empty draft. Set its prices and limits, then publish.")();
        }}
      >
        <PlanDetailsFields form={planForm} setForm={setPlanForm} withId />
      </PrivilegedActionDialog>

      {dialog?.kind === "edit_plan" && (
        <PrivilegedActionDialog
          open
          onClose={() => setDialog(null)}
          actionKey="plan.update"
          target={{ type: "platform", id: dialog.plan.id, label: dialog.plan.name }}
          canSubmit={planForm.name.trim().length >= 2}
          execute={async (a) =>
            (
              await platformRequest(`/api/v1/platform/plans/${encodeURIComponent(dialog.plan.id)}`, {
                method: "PATCH",
                json: {
                  name: planForm.name.trim(),
                  description: planForm.description.trim(),
                  visibility: planForm.visibility,
                  display_order: planForm.display_order ? Number(planForm.display_order) : null,
                  highlight_label: planForm.highlight_label.trim() || null,
                  reason: a.reason,
                },
              })
            ).data
          }
          onDone={done("Plan details saved.")}
        >
          <PlanDetailsFields form={planForm} setForm={setPlanForm} />
        </PrivilegedActionDialog>
      )}

      {(dialog?.kind === "publish" || dialog?.kind === "retire") && (
        <PrivilegedActionDialog
          open
          onClose={() => setDialog(null)}
          actionKey={dialog.kind === "publish" ? "plan.version_publish" : "plan.version_retire"}
          target={{ type: "plan_version", id: dialog.versionId, label: `${dialog.plan.name} v${dialog.version}` }}
          execute={async (a) =>
            (
              await platformRequest(`/api/v1/platform/plans/versions/${encodeURIComponent(dialog.versionId)}`, {
                method: "POST",
                json: { action: dialog.kind === "publish" ? "PUBLISH" : "RETIRE", reason: a.reason },
              })
            ).data
          }
          onDone={done(dialog.kind === "publish" ? `${dialog.plan.name} v${dialog.version} is published for new subscribers.` : `${dialog.plan.name} v${dialog.version} is retired; current subscribers keep it.`)}
        >
          <span className={styles.hint}>
            {dialog.kind === "publish"
              ? "New subscribers get this version. Existing subscribers stay on theirs until you move them."
              : "No new tenant can be put on this version. Its current subscribers are not affected."}
          </span>
        </PrivilegedActionDialog>
      )}

      <PrivilegedActionDialog
        open={dialog?.kind === "create_addon"}
        onClose={() => setDialog(null)}
        actionKey="addon.create"
        target={{ type: "platform", id: "new-addon", label: addonForm.name || "New add-on" }}
        canSubmit={addonForm.name.trim().length >= 2 && Boolean(addonForm.entitlement_id) && /^\d+$/.test(addonForm.increment) && Number(addonForm.increment) >= 1}
        execute={async (a) =>
          (
            await platformRequest("/api/v1/platform/addons", {
              method: "POST",
              json: {
                action: "CREATE",
                name: addonForm.name.trim(),
                description: addonForm.description.trim(),
                entitlement_id: addonForm.entitlement_id,
                increment: Number(addonForm.increment),
                allowed_plan_ids: addonForm.allowed,
                reason: a.reason,
              },
            })
          ).data
        }
        onDone={() => {
          setAddonForm({ name: "", description: "", entitlement_id: "", increment: "", allowed: [] });
          done("Add-on created.")();
        }}
      >
        <label className={styles.field}>
          Name
          <input className={styles.input} value={addonForm.name} onChange={(e) => setAddonForm({ ...addonForm, name: e.target.value })} />
        </label>
        <label className={styles.field}>
          Description
          <input className={styles.input} value={addonForm.description} onChange={(e) => setAddonForm({ ...addonForm, description: e.target.value })} />
        </label>
        <label className={styles.field}>
          Raises
          <select className={styles.select} value={addonForm.entitlement_id} onChange={(e) => setAddonForm({ ...addonForm, entitlement_id: e.target.value })}>
            <option value="">Choose a limit</option>
            {ENTITLEMENT_CATALOG.filter((s) => s.enforcedBy && s.addonEligible && s.kind !== "FEATURE").map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Amount per unit
          <input className={styles.input} inputMode="numeric" value={addonForm.increment} onChange={(e) => setAddonForm({ ...addonForm, increment: e.target.value.replace(/\D/g, "") })} />
        </label>
        <fieldset className={styles.field}>
          <legend>Available on (none = every plan)</legend>
          {planList.map((p) => (
            <label key={p.id}>
              <input
                type="checkbox"
                checked={addonForm.allowed.includes(p.id)}
                onChange={(e) =>
                  setAddonForm({ ...addonForm, allowed: e.target.checked ? [...addonForm.allowed, p.id] : addonForm.allowed.filter((x) => x !== p.id) })
                }
              />{" "}
              {p.name}
            </label>
          ))}
        </fieldset>
      </PrivilegedActionDialog>

      {dialog?.kind === "retire_addon" && (
        <PrivilegedActionDialog
          open
          onClose={() => setDialog(null)}
          actionKey="addon.retire"
          target={{ type: "platform", id: dialog.addon.id, label: dialog.addon.name }}
          execute={async (a) => (await platformRequest("/api/v1/platform/addons", { method: "POST", json: { action: "RETIRE", addon_id: dialog.addon.id, reason: a.reason } })).data}
          onDone={done("Add-on retired. Existing grants keep applying until they end.")}
        />
      )}

      {dialog?.kind === "migrate" && impact && (
        <PrivilegedActionDialog
          open
          onClose={() => setDialog(null)}
          actionKey="plan.migrate"
          target={{ type: "plan_version", id: impact.to_version.id, label: `${impact.from_version.plan_id} v${impact.from_version.version} → ${impact.to_version.plan_id} v${impact.to_version.version}` }}
          execute={async (a) =>
            (
              await platformRequest(
                "/api/v1/platform/plans/migrate",
                {
                  method: "POST",
                  json: {
                    from_version_id: impact.from_version.id,
                    to_version_id: impact.to_version.id,
                    reason: a.reason,
                    ...(a.ticketRef ? { ticket_ref: a.ticketRef } : {}),
                    ...(a.approvalId ? { approval_id: a.approvalId } : {}),
                  },
                },
                a.stepUpToken
              )
            ).data
          }
          onDone={(r) => {
            const migrated = (r as { migrated?: number })?.migrated;
            setFromVersion("");
            setToVersion("");
            done(`${formatCount(migrated ?? null)} tenants moved.`)();
          }}
        >
          <span className={styles.hint}>
            {formatCount(impact.affected_tenants)} tenants move now. MRR {formatMoney(impact.mrr_before_bdt, "BDT")} → {formatMoney(impact.mrr_after_bdt, "BDT")}.
          </span>
        </PrivilegedActionDialog>
      )}
    </>
  );
}

function PlanDetailsFields({
  form,
  setForm,
  withId = false,
}: {
  form: { id: string; name: string; description: string; visibility: string; display_order: string; highlight_label: string };
  setForm: (f: { id: string; name: string; description: string; visibility: string; display_order: string; highlight_label: string }) => void;
  withId?: boolean;
}) {
  return (
    <>
      {withId && (
        <label className={styles.field}>
          Plan id
          <span className={styles.hint}>Capital letters, digits and underscores, e.g. GROWTH_PLUS. Can&apos;t be changed later.</span>
          <input className={styles.input} value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })} />
        </label>
      )}
      <label className={styles.field}>
        Name
        <input className={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <label className={styles.field}>
        Description
        <input className={styles.input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>
      <label className={styles.field}>
        Visibility
        <select className={styles.select} value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
          <option value="PUBLIC">Public — offered to every workspace</option>
          <option value="HIDDEN">Hidden — operators assign it</option>
          <option value="PRIVATE">Private — a custom deal for named tenants</option>
        </select>
      </label>
      <label className={styles.field}>
        Display order (optional)
        <input className={styles.input} inputMode="numeric" value={form.display_order} onChange={(e) => setForm({ ...form, display_order: e.target.value.replace(/\D/g, "") })} />
      </label>
      <label className={styles.field}>
        Highlight label (optional)
        <input className={styles.input} value={form.highlight_label} maxLength={40} onChange={(e) => setForm({ ...form, highlight_label: e.target.value })} placeholder="e.g. Most popular" />
      </label>
    </>
  );
}
