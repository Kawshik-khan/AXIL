"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, RefreshCw } from "lucide-react";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { PLATFORM_PERMISSIONS } from "@/lib/permissions";
import type { PlanView } from "@/domains/platform/services/platform-plan.service";
import { usePlatformResource } from "../../_lib/use-platform-resource";
import { usePlatformSession } from "../../_lib/platform-session";
import { platformRequest } from "../../_lib/platform-client";
import { formatCount, formatDateTime, humanize } from "../../_lib/format";
import { CONSOLE_ROOT } from "../../_lib/platform-module-access";
import { PageHeader } from "../../_components/PageHeader";
import { ResourceView } from "../../_components/ResourceView";
import { StatusPill } from "../../_components/StatusPill";
import { PrivilegedActionDialog } from "../../_components/PrivilegedActionDialog";
import styles from "../../super-admin.module.css";

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan_id?: string;
  created_at: string;
  subscription: { plan_id: string; status: string; current_period_end: string } | null;
  metrics: { user_count: number; automation_count: number };
}

interface ProvisionResult {
  tenant: { id: string; name: string };
  owner: { email: string };
  owner_setup_required: boolean;
  owner_setup_path: string | null;
}

const PAGE_SIZE = 25;
const STATUSES = ["ACTIVE", "TRIAL", "SUSPENDED", "PAST_DUE", "ARCHIVED", "CANCELLED"] as const;

export default function TenantsPage() {
  const { can } = usePlatformSession();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [planId, setPlanId] = useState("");
  const [offset, setOffset] = useState(0);
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [provisioned, setProvisioned] = useState<ProvisionResult | null>(null);
  const [form, setForm] = useState({ name: "", slug: "", plan_id: "", owner_email: "", owner_name: "", start_trial: false });

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebounced(search.trim());
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(id);
  }, [search]);

  const url = useMemo(() => {
    const q = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (debounced) q.set("search", debounced);
    if (status) q.set("status", status);
    if (planId) q.set("plan_id", planId);
    return `/api/v1/platform/tenants?${q.toString()}`;
  }, [debounced, status, planId, offset]);

  const tenants = usePlatformResource<TenantRow[]>(url, { isEmpty: (rows) => rows.length === 0 });
  const canReadPlans = can(PLATFORM_PERMISSIONS.PLAN_READ);
  const plans = usePlatformResource<PlanView[]>(canReadPlans ? "/api/v1/platform/plans" : null);
  const planOptions = plans.state.kind === "ready" ? plans.state.data.filter((p) => p.current_version) : [];
  const filtered = Boolean(debounced || status || planId);
  const total = tenants.state.kind === "ready" ? Number(tenants.state.meta?.total ?? 0) : 0;

  const provisionReady =
    form.name.trim().length >= 2 && /^[a-z0-9][a-z0-9-]{1,62}$/.test(form.slug) && form.plan_id && /.+@.+\..+/.test(form.owner_email) && form.owner_name.trim();

  return (
    <>
      <PageHeader
        title="Tenants"
        description="Every workspace on the platform, from the tenants API. Open one for usage, plan, support and lifecycle."
        fetchedAt={tenants.state.kind === "ready" ? tenants.state.fetchedAt : undefined}
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={tenants.reload}>
              Refresh
            </Button>
            {can(PLATFORM_PERMISSIONS.TENANT_CREATE) && canReadPlans && (
              <Button size="sm" icon={<Plus size={14} />} onClick={() => setProvisionOpen(true)}>
                Provision tenant
              </Button>
            )}
          </>
        }
      />

      {provisioned && (
        <div className={`${styles.banner} ${styles.bannerInfo}`} role="status">
          <span>
            {provisioned.tenant.name} is provisioned.{" "}
            {provisioned.owner_setup_required && provisioned.owner_setup_path
              ? `Send ${provisioned.owner.email} this one-time setup link (shown once): ${window.location.origin}${provisioned.owner_setup_path}`
              : `${provisioned.owner.email} already has an account and can sign in.`}
          </span>
          <Link href={`${CONSOLE_ROOT}/tenants/${encodeURIComponent(provisioned.tenant.id)}`}>Open</Link>
        </div>
      )}

      <BentoGrid>
        <BentoCard span={12}>
          <div className={styles.toolbar}>
            <input
              className={styles.input}
              placeholder="Search name, slug or legal name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search tenants"
            />
            <select className={styles.select} value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} aria-label="Status">
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
            {canReadPlans && (
              <select className={styles.select} value={planId} onChange={(e) => { setPlanId(e.target.value); setOffset(0); }} aria-label="Plan">
                <option value="">All plans</option>
                {plans.state.kind === "ready" &&
                  plans.state.data.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            )}
            {tenants.state.kind === "ready" && <span className={styles.asOf}>{formatCount(total)} matching</span>}
          </div>

          <ResourceView
            state={tenants.state}
            onRetry={tenants.reload}
            resource="tenants"
            emptyFigure={filtered ? (debounced ? "no-results" : "filtered-out") : "empty-list"}
            emptyTitle={filtered ? "No tenants match" : "No tenants yet"}
            emptyDescription={filtered ? "Change the search or filters." : "Provision the first workspace to get started."}
            skeletonLines={6}
            renderReady={(rows) => (
              <>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Workspace</th>
                        <th>Status</th>
                        <th>Plan</th>
                        <th>Subscription</th>
                        <th className={styles.numeric}>Staff</th>
                        <th className={styles.numeric}>Automations</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((t) => (
                        <tr key={t.id}>
                          <td>
                            <Link href={`${CONSOLE_ROOT}/tenants/${encodeURIComponent(t.id)}`} className={styles.rowLink}>
                              <span className={styles.rowMain}>
                                <span className={styles.rowTitle}>{t.name}</span>
                                <span className={styles.rowMeta}>{t.slug}</span>
                              </span>
                            </Link>
                          </td>
                          <td>
                            <StatusPill status={t.status} />
                          </td>
                          <td>{t.subscription?.plan_id ?? t.plan_id ?? "None"}</td>
                          <td>{t.subscription ? <StatusPill status={t.subscription.status} /> : <span className={styles.muted}>None</span>}</td>
                          <td className={styles.numeric}>{formatCount(t.metrics.user_count)}</td>
                          <td className={styles.numeric}>{formatCount(t.metrics.automation_count)}</td>
                          <td>{formatDateTime(t.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={styles.toolbar}>
                  <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                    Previous
                  </Button>
                  <span className={styles.asOf}>
                    {formatCount(offset + 1)}–{formatCount(Math.min(offset + rows.length, total))} of {formatCount(total)}
                  </span>
                  <Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
                    Next
                  </Button>
                </div>
              </>
            )}
          />
        </BentoCard>
      </BentoGrid>

      <PrivilegedActionDialog
        open={provisionOpen}
        onClose={() => setProvisionOpen(false)}
        actionKey="tenant.create"
        target={{ type: "tenant", id: form.slug || "new", label: form.name || "New workspace" }}
        canSubmit={Boolean(provisionReady)}
        submitLabel="Provision"
        execute={async () =>
          (
            await platformRequest<ProvisionResult>("/api/v1/platform/tenants", {
              method: "POST",
              json: {
                name: form.name.trim(),
                slug: form.slug,
                plan_id: form.plan_id,
                owner_email: form.owner_email.trim(),
                owner_name: form.owner_name.trim(),
                start_trial: form.start_trial,
              },
            })
          ).data
        }
        onDone={(result) => {
          setProvisioned(result as ProvisionResult);
          setForm({ name: "", slug: "", plan_id: "", owner_email: "", owner_name: "", start_trial: false });
          tenants.reload();
        }}
      >
        <label className={styles.field}>
          Workspace name
          <input className={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className={styles.field}>
          Slug
          <span className={styles.hint}>Lowercase letters, digits and dashes; used in links.</span>
          <input
            className={styles.input}
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
          />
        </label>
        <label className={styles.field}>
          Plan
          <select className={styles.select} value={form.plan_id} onChange={(e) => setForm({ ...form, plan_id: e.target.value })}>
            <option value="">Choose a plan with a published version</option>
            {planOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (v{p.current_version?.version})
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>
            <input type="checkbox" checked={form.start_trial} onChange={(e) => setForm({ ...form, start_trial: e.target.checked })} /> Start
            as a trial
          </span>
          <span className={styles.hint}>Trial length comes from the plan version, else the default trial setting.</span>
        </label>
        <label className={styles.field}>
          Owner name
          <input className={styles.input} value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} />
        </label>
        <label className={styles.field}>
          Owner email
          <input className={styles.input} type="email" value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })} />
        </label>
      </PrivilegedActionDialog>
    </>
  );
}
