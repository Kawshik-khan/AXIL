"use client";

import React, { useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { PermissionDenied } from "@/components/ui/States/States";
import { PLATFORM_PERMISSIONS } from "@/lib/permissions";
import { KNOWN_FLAGS, findKnownFlag } from "@/domains/platform/feature-flag-registry";
import type { PlatformFeatureFlagRecord, PlatformIncidentRecord, PlatformKillSwitchRecord } from "@/types/platform";
import type { MaintenanceView, AnnouncementView } from "@/domains/platform/services/platform-communications.service";
import { usePlatformResource } from "../../_lib/use-platform-resource";
import { usePlatformSession } from "../../_lib/platform-session";
import { PlatformApiError, platformRequest } from "../../_lib/platform-client";
import { formatDateTime, formatRelative, humanize } from "../../_lib/format";
import { PageHeader } from "../../_components/PageHeader";
import { ResourceView } from "../../_components/ResourceView";
import { StatusPill } from "../../_components/StatusPill";
import { Tabs, useTab, type TabDef } from "../../_components/Tabs";
import { PrivilegedActionDialog } from "../../_components/PrivilegedActionDialog";
import styles from "../../super-admin.module.css";

type TabId = "kill" | "flags" | "incidents" | "maintenance" | "announcements";
type Scope = "GLOBAL" | "TENANT" | "CHANNEL" | "WORKFLOW" | "PROVIDER";

const SCOPE_HELP: Record<Scope, string> = {
  GLOBAL: "Every non-GET request on the platform is refused (two operators).",
  TENANT: "Every change in one workspace is refused; reads keep working.",
  CHANNEL: "Outbound messages, campaigns and AI replies on a channel id or type stop.",
  WORKFLOW: "Runs of one workflow are halted.",
  PROVIDER: "Calls to one provider (AI model, courier, payment) are refused.",
};

const CHANNEL_TYPES = ["FACEBOOK_MESSENGER", "INSTAGRAM", "WHATSAPP", "WEBSITE_CHAT", "TIKTOK", "TELEGRAM", "EMAIL", "SMS", "MARKETPLACE"];

function localToIso(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export default function SafetyPage() {
  const { can } = usePlatformSession();
  const tabs: TabDef<TabId>[] = [
    { id: "kill", label: "Kill switches", visible: can(PLATFORM_PERMISSIONS.SECURITY_READ) },
    { id: "flags", label: "Feature flags", visible: can(PLATFORM_PERMISSIONS.FEATURE_FLAG_READ) },
    { id: "incidents", label: "Incidents" },
    { id: "maintenance", label: "Maintenance", visible: can(PLATFORM_PERMISSIONS.MAINTENANCE_READ) },
    { id: "announcements", label: "Announcements" },
  ];
  const [tab, setTab] = useTab(tabs, "kill");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const switches = usePlatformResource<PlatformKillSwitchRecord[]>(tab === "kill" ? "/api/v1/platform/safety/kill-switch" : null);
  const flags = usePlatformResource<PlatformFeatureFlagRecord[]>(tab === "flags" ? "/api/v1/platform/feature-flags" : null);
  const incidents = usePlatformResource<PlatformIncidentRecord[]>(tab === "incidents" ? "/api/v1/platform/incidents" : null, { isEmpty: (l) => l.length === 0 });
  const maintenance = usePlatformResource<MaintenanceView[]>(tab === "maintenance" ? "/api/v1/platform/maintenance" : null, { isEmpty: (l) => l.length === 0 });
  const announcements = usePlatformResource<AnnouncementView[]>(tab === "announcements" ? "/api/v1/platform/announcements" : null, { isEmpty: (l) => l.length === 0 });
  const tenantsForPicker = usePlatformResource<Array<{ id: string; name: string }>>(
    tab === "kill" && can(PLATFORM_PERMISSIONS.TENANT_READ) ? "/api/v1/platform/tenants?limit=200" : null
  );

  // Kill switch form
  const [ksOpen, setKsOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("TENANT");
  const [ksTarget, setKsTarget] = useState("");
  const [deactivate, setDeactivate] = useState<PlatformKillSwitchRecord | null>(null);
  // Flag form
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagForm, setFlagForm] = useState({ key: "", description: "", enabled: false, pct: "100", allowlist: "" });
  // Incident form
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [incidentForm, setIncidentForm] = useState({ title: "", severity: "SEV3", components: "", impact: "" });
  // Maintenance form
  const [mwOpen, setMwOpen] = useState(false);
  const [mwForm, setMwForm] = useState({ title: "", description: "", start: "", end: "" });
  const [mwCancel, setMwCancel] = useState<MaintenanceView | null>(null);
  // Announcement form
  const [annOpen, setAnnOpen] = useState(false);
  const [annForm, setAnnForm] = useState({ id: "", title: "", message: "", type: "INFO", scope: "ALL_TENANTS", plans: "", tenants: "", expires: "" });

  const switchId = scope === "GLOBAL" ? "KILL_SWITCH_GLOBAL" : `KILL_SWITCH_${scope}_${ksTarget}`;
  const flagRows = useMemo(() => {
    const stored = flags.state.kind === "ready" ? flags.state.data : [];
    const known = KNOWN_FLAGS.map((k) => ({ known: k, flag: stored.find((f) => f.key === k.key) ?? null }));
    const unknown = stored.filter((f) => !findKnownFlag(f.key));
    return { known, unknown };
  }, [flags.state]);

  const act = async (fn: () => Promise<unknown>, ok: string, reload: () => void) => {
    setError(null);
    try {
      await fn();
      setNotice(ok);
      reload();
    } catch (err) {
      setError(err instanceof PlatformApiError ? `${err.message}${err.requestId ? ` (request ${err.requestId})` : ""}` : "The request failed.");
    }
  };

  return (
    <>
      <PageHeader
        title="Safety & Releases"
        description="Emergency stops, feature rollouts, incidents, maintenance and merchant announcements."
        actions={
          <Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={() => { switches.reload(); flags.reload(); incidents.reload(); maintenance.reload(); announcements.reload(); }}>
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
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "kill" && (
        <BentoGrid>
          <BentoCard span={12} className={styles.darkCard} title="Kill switches" subtitle="Enforced on every request by src/lib/safety-gate.ts"
            action={can(PLATFORM_PERMISSIONS.SECURITY_MANAGE) ? (
              <Button size="sm" variant="danger" onClick={() => { setScope("TENANT"); setKsTarget(""); setKsOpen(true); }}>
                Activate a switch
              </Button>
            ) : undefined}
          >
            <ResourceView
              state={switches.state.kind === "ready" && switches.state.data.length === 0 ? { kind: "empty", fetchedAt: switches.state.fetchedAt } : switches.state}
              onRetry={switches.reload}
              resource="kill switches"
              surface="dark"
              emptyFigure="all-clear"
              emptyTitle="No kill switch has ever been used"
              emptyDescription="Switches you activate stay listed with who turned them on and off."
              renderReady={(rows) => (
                <ul className={styles.list}>
                  {rows
                    .slice()
                    .sort((a, b) => Number(b.is_active) - Number(a.is_active) || (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
                    .map((s) => (
                      <li key={s.id} className={styles.listRow}>
                        <span className={styles.rowMain}>
                          <span className={styles.rowTitle}>
                            {humanize(s.scope)}
                            {s.target_id ? `: ${s.target_id}` : ""}
                          </span>
                          <span className={styles.rowMeta}>
                            {s.is_active ? `Active since ${formatDateTime(s.activated_at)}` : `Off since ${formatDateTime(s.deactivated_at)}`} · {s.reason}
                          </span>
                        </span>
                        <span className={styles.inlineActions}>
                          <StatusPill status={s.is_active ? "BLOCKED" : "DISABLED"} tone={s.is_active ? "bad" : "neutral"} label={s.is_active ? "Active" : "Off"} />
                          {s.is_active && can(PLATFORM_PERMISSIONS.SECURITY_MANAGE) && (
                            <Button size="sm" variant="outline" onClick={() => setDeactivate(s)}>
                              Deactivate
                            </Button>
                          )}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            />
          </BentoCard>
        </BentoGrid>
      )}

      {tab === "flags" && (
        <BentoCard span={12} title="Feature flags" subtitle="Only flags the code reads can be set; others are listed so you can see they do nothing"
          action={can(PLATFORM_PERMISSIONS.FEATURE_FLAG_MANAGE) ? (
            <Button size="sm" icon={<Plus size={14} />} onClick={() => { setFlagForm({ key: "", description: "", enabled: false, pct: "100", allowlist: "" }); setFlagOpen(true); }}>
              Set a flag
            </Button>
          ) : undefined}
        >
          <ResourceView
            state={flags.state}
            onRetry={flags.reload}
            resource="feature flags"
            emptyFigure="releases-empty"
            emptyTitle="No flags"
            emptyDescription="Flags control staged rollouts."
            renderReady={() => (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Flag</th>
                      <th>State</th>
                      <th>Rollout</th>
                      <th>Allow-list</th>
                      <th>Updated</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {flagRows.known.map(({ known, flag }) => (
                      <tr key={known.key}>
                        <td>
                          <span className={styles.rowMain}>
                            <span className={styles.rowTitle}>{known.label}</span>
                            <span className={styles.rowMeta}>
                              <code>{known.key}</code> · read by {known.readBy}
                            </span>
                          </span>
                        </td>
                        <td>
                          {flag ? (
                            <StatusPill status={flag.is_enabled_globally ? "ENABLED" : "DISABLED"} />
                          ) : (
                            <StatusPill status="NOT_VERIFIED" label={`No record: ${known.whenAbsent === "ON" ? "on" : "off"} by default`} />
                          )}
                        </td>
                        <td>{flag ? `${flag.percentage_rollout}%` : "—"}</td>
                        <td>{flag && flag.tenant_allowlist.length ? `${flag.tenant_allowlist.length} tenants` : "—"}</td>
                        <td>{flag ? formatRelative(flag.updated_at) : "—"}</td>
                        <td>
                          {can(PLATFORM_PERMISSIONS.FEATURE_FLAG_MANAGE) && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setFlagForm({
                                  key: known.key,
                                  description: flag?.description ?? known.label,
                                  enabled: flag?.is_enabled_globally ?? known.whenAbsent === "ON",
                                  pct: String(flag?.percentage_rollout ?? 100),
                                  allowlist: (flag?.tenant_allowlist ?? []).join(", "),
                                });
                                setFlagOpen(true);
                              }}
                            >
                              Edit
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {flagRows.unknown.map((f) => (
                      <tr key={f.id}>
                        <td>
                          <span className={styles.rowMain}>
                            <span className={styles.rowTitle}>{f.description}</span>
                            <span className={styles.rowMeta}>
                              <code>{f.key}</code>
                            </span>
                          </span>
                        </td>
                        <td>
                          <StatusPill status="SIMULATED" label="Not read by any code" />
                        </td>
                        <td>—</td>
                        <td>—</td>
                        <td>{formatRelative(f.updated_at)}</td>
                        <td />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          />
        </BentoCard>
      )}

      {tab === "incidents" && (
        <BentoCard span={12} title="Incidents" action={can(PLATFORM_PERMISSIONS.PLATFORM_MANAGE) ? (
          <Button size="sm" icon={<Plus size={14} />} onClick={() => setIncidentOpen(true)}>Declare incident</Button>
        ) : undefined}>
          <ResourceView
            state={incidents.state}
            onRetry={incidents.reload}
            resource="incidents"
            emptyFigure="all-clear"
            emptyTitle="No incidents"
            emptyDescription="Declared incidents and their status changes appear here."
            renderReady={(rows) => (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Incident</th>
                      <th>Severity</th>
                      <th>Status</th>
                      <th>Started</th>
                      <th>Owner</th>
                      <th>Move to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((i) => (
                      <tr key={i.id}>
                        <td>
                          <span className={styles.rowMain}>
                            <span className={styles.rowTitle}>{i.title}</span>
                            <span className={styles.rowMeta}>{[i.affected_components.join(", "), i.impact_summary].filter(Boolean).join(" · ")}</span>
                          </span>
                        </td>
                        <td>{i.severity}</td>
                        <td>
                          <StatusPill status={i.status} />
                        </td>
                        <td>{formatDateTime(i.started_at)}</td>
                        <td>{i.owner ?? "—"}</td>
                        <td>
                          {can(PLATFORM_PERMISSIONS.PLATFORM_MANAGE) && i.status !== "CLOSED" && (
                            <select
                              className={styles.select}
                              value=""
                              aria-label="Change status"
                              onChange={(e) => {
                                const status = e.target.value;
                                if (!status) return;
                                void act(
                                  () => platformRequest("/api/v1/platform/incidents", { method: "PATCH", json: { id: i.id, status, notes: "" } }),
                                  `Incident moved to ${humanize(status)}.`,
                                  incidents.reload
                                );
                              }}
                            >
                              <option value="">Choose…</option>
                              {["INVESTIGATING", "IDENTIFIED", "MITIGATING", "MONITORING", "RESOLVED", "CLOSED"]
                                .filter((s) => s !== i.status)
                                .map((s) => (
                                  <option key={s} value={s}>
                                    {humanize(s)}
                                  </option>
                                ))}
                            </select>
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

      {tab === "maintenance" && (
        <BentoCard span={12} title="Maintenance windows" subtitle="Informational: shown as a banner in the console and merchant workspaces; nothing is blocked"
          action={can(PLATFORM_PERMISSIONS.MAINTENANCE_MANAGE) ? (
            <Button size="sm" icon={<Plus size={14} />} onClick={() => setMwOpen(true)}>Schedule</Button>
          ) : undefined}>
          <ResourceView
            state={maintenance.state}
            onRetry={maintenance.reload}
            resource="maintenance windows"
            emptyFigure="empty-list"
            emptyTitle="No maintenance scheduled"
            emptyDescription="Merchants see windows in progress or starting within 72 hours."
            renderReady={(rows) => (
              <ul className={styles.list}>
                {rows.map((w) => (
                  <li key={w.id} className={styles.listRow}>
                    <span className={styles.rowMain}>
                      <span className={styles.rowTitle}>{w.title}</span>
                      <span className={styles.rowMeta}>
                        {formatDateTime(w.scheduled_start)} – {formatDateTime(w.scheduled_end)} · {w.description}
                      </span>
                    </span>
                    <span className={styles.inlineActions}>
                      <StatusPill status={w.effective_status} />
                      {can(PLATFORM_PERMISSIONS.MAINTENANCE_MANAGE) && (w.effective_status === "SCHEDULED" || w.effective_status === "IN_PROGRESS") && (
                        <Button size="sm" variant="ghost" onClick={() => setMwCancel(w)}>
                          Cancel
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          />
        </BentoCard>
      )}

      {tab === "announcements" && (
        <BentoCard span={12} title="Announcements" subtitle="Published announcements appear at the top of targeted merchant workspaces"
          action={can(PLATFORM_PERMISSIONS.ANNOUNCEMENT_CREATE) ? (
            <Button size="sm" icon={<Plus size={14} />} onClick={() => { setAnnForm({ id: "", title: "", message: "", type: "INFO", scope: "ALL_TENANTS", plans: "", tenants: "", expires: "" }); setAnnOpen(true); }}>
              New announcement
            </Button>
          ) : undefined}>
          <ResourceView
            state={announcements.state}
            onRetry={announcements.reload}
            resource="announcements"
            emptyFigure="empty-list"
            emptyTitle="No announcements"
            emptyDescription="Draft one, then publish it to all workspaces, a plan, or named tenants."
            renderReady={(rows) => (
              <ul className={styles.list}>
                {rows.map((a) => (
                  <li key={a.id} className={styles.listRow}>
                    <span className={styles.rowMain}>
                      <span className={styles.rowTitle}>{a.title}</span>
                      <span className={styles.rowMeta}>
                        {humanize(a.announcement_type)} · {humanize(a.target_scope)}
                        {a.expires_at ? ` · until ${formatDateTime(a.expires_at)}` : ""} · {a.message}
                      </span>
                    </span>
                    <span className={styles.inlineActions}>
                      <StatusPill status={a.effective_status} />
                      {can(PLATFORM_PERMISSIONS.ANNOUNCEMENT_PUBLISH) && a.effective_status === "DRAFT" && (
                        <Button size="sm" onClick={() => act(() => platformRequest("/api/v1/platform/announcements", { method: "POST", json: { action: "PUBLISH", id: a.id } }), "Announcement published.", announcements.reload)}>
                          Publish
                        </Button>
                      )}
                      {can(PLATFORM_PERMISSIONS.ANNOUNCEMENT_PUBLISH) && a.is_published && (
                        <Button size="sm" variant="ghost" onClick={() => act(() => platformRequest("/api/v1/platform/announcements", { method: "POST", json: { action: "UNPUBLISH", id: a.id } }), "Announcement unpublished.", announcements.reload)}>
                          Unpublish
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          />
        </BentoCard>
      )}

      {/* ---------- Dialogs ---------- */}
      <PrivilegedActionDialog
        open={ksOpen}
        onClose={() => setKsOpen(false)}
        actionKey={scope === "GLOBAL" ? "kill_switch.activate_global" : "kill_switch.activate"}
        target={{ type: "kill_switch", id: switchId, label: scope === "GLOBAL" ? "Every workspace" : `${humanize(scope)} ${ksTarget}` }}
        impact={scope === "GLOBAL" || ksTarget ? { scope, target: scope === "GLOBAL" ? undefined : ksTarget } : null}
        canSubmit={scope === "GLOBAL" || ksTarget.trim().length > 0}
        execute={async (a) =>
          (
            await platformRequest(
              "/api/v1/platform/safety/kill-switch",
              {
                method: "POST",
                json: {
                  action: "ACTIVATE",
                  scope,
                  ...(scope !== "GLOBAL" ? { targetId: ksTarget.trim() } : {}),
                  reason: a.reason,
                  ...(a.ticketRef ? { ticket_ref: a.ticketRef } : {}),
                  ...(a.approvalId ? { approval_id: a.approvalId } : {}),
                  ...(a.confirmation ? { confirmation: a.confirmation } : {}),
                },
              },
              a.stepUpToken
            )
          ).data
        }
        onDone={() => {
          setNotice("Kill switch active.");
          switches.reload();
        }}
      >
        <label className={styles.field}>
          Scope
          <select className={styles.select} value={scope} onChange={(e) => { setScope(e.target.value as Scope); setKsTarget(""); }}>
            {(Object.keys(SCOPE_HELP) as Scope[]).map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
          <span className={styles.hint}>{SCOPE_HELP[scope]}</span>
        </label>
        {scope === "TENANT" && (
          <label className={styles.field}>
            Workspace
            {can(PLATFORM_PERMISSIONS.TENANT_READ) ? (
              <select className={styles.select} value={ksTarget} onChange={(e) => setKsTarget(e.target.value)}>
                <option value="">Choose a workspace</option>
                {tenantsForPicker.state.kind === "ready" &&
                  tenantsForPicker.state.data.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            ) : (
              <input className={styles.input} value={ksTarget} onChange={(e) => setKsTarget(e.target.value)} placeholder="Tenant id" />
            )}
          </label>
        )}
        {scope === "CHANNEL" && (
          <label className={styles.field}>
            Channel type or channel id
            <input className={styles.input} list="channel-types" value={ksTarget} onChange={(e) => setKsTarget(e.target.value)} />
            <datalist id="channel-types">
              {CHANNEL_TYPES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
        )}
        {(scope === "WORKFLOW" || scope === "PROVIDER") && (
          <label className={styles.field}>
            {scope === "WORKFLOW" ? "Workflow id" : "Provider name"}
            <input className={styles.input} value={ksTarget} onChange={(e) => setKsTarget(e.target.value)} />
          </label>
        )}
      </PrivilegedActionDialog>

      {deactivate && (
        <PrivilegedActionDialog
          open
          onClose={() => setDeactivate(null)}
          actionKey={deactivate.scope === "GLOBAL" ? "kill_switch.deactivate_global" : "kill_switch.deactivate"}
          target={{ type: "kill_switch", id: deactivate.id, label: `${humanize(deactivate.scope)}${deactivate.target_id ? ` ${deactivate.target_id}` : ""}` }}
          execute={async (a) =>
            (
              await platformRequest(
                "/api/v1/platform/safety/kill-switch",
                {
                  method: "POST",
                  json: {
                    action: "DEACTIVATE",
                    id: deactivate.id,
                    reason: a.reason,
                    ...(a.ticketRef ? { ticket_ref: a.ticketRef } : {}),
                    ...(a.approvalId ? { approval_id: a.approvalId } : {}),
                  },
                },
                a.stepUpToken
              )
            ).data
          }
          onDone={() => {
            setNotice("Kill switch off; operations resume.");
            switches.reload();
          }}
        >
          <span className={styles.hint}>Active since {formatDateTime(deactivate.activated_at)}: {deactivate.reason}</span>
        </PrivilegedActionDialog>
      )}

      <PrivilegedActionDialog
        open={flagOpen}
        onClose={() => setFlagOpen(false)}
        actionKey="feature_flag.save"
        target={{ type: "platform", id: flagForm.key || "flag", label: flagForm.key || "Feature flag" }}
        canSubmit={Boolean(findKnownFlag(flagForm.key)) && /^\d{1,3}$/.test(flagForm.pct) && Number(flagForm.pct) <= 100 && flagForm.description.trim().length > 0}
        execute={async (a) =>
          (
            await platformRequest("/api/v1/platform/feature-flags", {
              method: "POST",
              json: {
                key: flagForm.key,
                description: flagForm.description.trim(),
                is_enabled_globally: flagForm.enabled,
                percentage_rollout: Number(flagForm.pct),
                tenant_allowlist: flagForm.allowlist.split(",").map((t) => t.trim()).filter(Boolean),
                reason: a.reason,
              },
            })
          ).data
        }
        onDone={() => {
          setNotice(`Flag ${flagForm.key} saved.`);
          flags.reload();
        }}
      >
        <label className={styles.field}>
          Flag
          <select className={styles.select} value={flagForm.key} onChange={(e) => setFlagForm({ ...flagForm, key: e.target.value, description: findKnownFlag(e.target.value)?.label ?? flagForm.description })}>
            <option value="">Choose a flag the code reads</option>
            {KNOWN_FLAGS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label} ({f.key})
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Description
          <input className={styles.input} value={flagForm.description} onChange={(e) => setFlagForm({ ...flagForm, description: e.target.value })} />
        </label>
        <label className={styles.field}>
          <span>
            <input type="checkbox" checked={flagForm.enabled} onChange={(e) => setFlagForm({ ...flagForm, enabled: e.target.checked })} /> On for everyone in the rollout
          </span>
        </label>
        <label className={styles.field}>
          Rollout (% of workspaces, deterministic)
          <input className={styles.input} inputMode="numeric" value={flagForm.pct} onChange={(e) => setFlagForm({ ...flagForm, pct: e.target.value.replace(/\D/g, "") })} />
        </label>
        <label className={styles.field}>
          Always-on tenant ids (comma-separated)
          <span className={styles.hint}>Allow-listed workspaces get the flag even when it is off globally.</span>
          <input className={styles.input} value={flagForm.allowlist} onChange={(e) => setFlagForm({ ...flagForm, allowlist: e.target.value })} />
        </label>
      </PrivilegedActionDialog>

      <PrivilegedActionDialog
        open={incidentOpen}
        onClose={() => setIncidentOpen(false)}
        actionKey="incident.declare"
        target={{ type: "platform", id: "incident", label: incidentForm.title || "New incident" }}
        canSubmit={incidentForm.title.trim().length >= 5}
        execute={async () =>
          (
            await platformRequest("/api/v1/platform/incidents", {
              method: "POST",
              json: {
                title: incidentForm.title.trim(),
                severity: incidentForm.severity,
                affected_components: incidentForm.components.split(",").map((c) => c.trim()).filter(Boolean),
                ...(incidentForm.impact.trim() ? { impact_summary: incidentForm.impact.trim() } : {}),
              },
            })
          ).data
        }
        onDone={() => {
          setIncidentForm({ title: "", severity: "SEV3", components: "", impact: "" });
          setNotice("Incident declared.");
          incidents.reload();
        }}
      >
        <label className={styles.field}>
          Title
          <input className={styles.input} value={incidentForm.title} onChange={(e) => setIncidentForm({ ...incidentForm, title: e.target.value })} />
        </label>
        <label className={styles.field}>
          Severity
          <select className={styles.select} value={incidentForm.severity} onChange={(e) => setIncidentForm({ ...incidentForm, severity: e.target.value })}>
            <option value="SEV1">SEV1 — platform down</option>
            <option value="SEV2">SEV2 — major feature down</option>
            <option value="SEV3">SEV3 — degraded</option>
            <option value="SEV4">SEV4 — minor</option>
          </select>
        </label>
        <label className={styles.field}>
          Affected components (comma-separated)
          <input className={styles.input} value={incidentForm.components} onChange={(e) => setIncidentForm({ ...incidentForm, components: e.target.value })} />
        </label>
        <label className={styles.field}>
          Impact
          <textarea className={styles.textarea} value={incidentForm.impact} onChange={(e) => setIncidentForm({ ...incidentForm, impact: e.target.value })} />
        </label>
      </PrivilegedActionDialog>

      <PrivilegedActionDialog
        open={mwOpen}
        onClose={() => setMwOpen(false)}
        actionKey="maintenance.schedule"
        target={{ type: "platform", id: "maintenance", label: mwForm.title || "Maintenance window" }}
        canSubmit={mwForm.title.trim().length >= 3 && mwForm.description.trim().length >= 3 && Boolean(localToIso(mwForm.start)) && Boolean(localToIso(mwForm.end))}
        execute={async (a) =>
          (
            await platformRequest("/api/v1/platform/maintenance", {
              method: "POST",
              json: { action: "SCHEDULE", title: mwForm.title.trim(), description: mwForm.description.trim(), scheduled_start: localToIso(mwForm.start), scheduled_end: localToIso(mwForm.end), reason: a.reason },
            })
          ).data
        }
        onDone={() => {
          setMwForm({ title: "", description: "", start: "", end: "" });
          setNotice("Maintenance window scheduled.");
          maintenance.reload();
        }}
      >
        <label className={styles.field}>
          Title
          <input className={styles.input} value={mwForm.title} onChange={(e) => setMwForm({ ...mwForm, title: e.target.value })} />
        </label>
        <label className={styles.field}>
          What merchants should know
          <textarea className={styles.textarea} value={mwForm.description} onChange={(e) => setMwForm({ ...mwForm, description: e.target.value })} />
        </label>
        <label className={styles.field}>
          Starts
          <input className={styles.input} type="datetime-local" value={mwForm.start} onChange={(e) => setMwForm({ ...mwForm, start: e.target.value })} />
        </label>
        <label className={styles.field}>
          Ends
          <input className={styles.input} type="datetime-local" value={mwForm.end} onChange={(e) => setMwForm({ ...mwForm, end: e.target.value })} />
        </label>
      </PrivilegedActionDialog>

      {mwCancel && (
        <PrivilegedActionDialog
          open
          onClose={() => setMwCancel(null)}
          actionKey="maintenance.cancel"
          submitLabel="Cancel window"
          target={{ type: "platform", id: mwCancel.id, label: mwCancel.title }}
          execute={async (a) => (await platformRequest("/api/v1/platform/maintenance", { method: "POST", json: { action: "CANCEL", id: mwCancel.id, reason: a.reason } })).data}
          onDone={() => {
            setNotice("Maintenance window cancelled.");
            maintenance.reload();
          }}
        />
      )}

      {annOpen && (can(PLATFORM_PERMISSIONS.ANNOUNCEMENT_CREATE) ? (
        <PrivilegedActionDialog
          open
          onClose={() => setAnnOpen(false)}
          actionKey="announcement.save"
          submitLabel="Save draft"
          target={{ type: "platform", id: annForm.id || "announcement", label: annForm.title || "Announcement" }}
          canSubmit={annForm.title.trim().length >= 3 && annForm.message.trim().length >= 3 && (annForm.scope !== "PLAN" || annForm.plans.trim().length > 0) && (annForm.scope !== "TENANT_LIST" || annForm.tenants.trim().length > 0)}
          execute={async () =>
            (
              await platformRequest("/api/v1/platform/announcements", {
                method: "POST",
                json: {
                  action: "SAVE",
                  title: annForm.title.trim(),
                  message: annForm.message.trim(),
                  announcement_type: annForm.type,
                  target_scope: annForm.scope,
                  ...(annForm.scope === "PLAN" ? { plan_ids: annForm.plans.split(",").map((p) => p.trim().toUpperCase()).filter(Boolean) } : {}),
                  ...(annForm.scope === "TENANT_LIST" ? { target_tenant_ids: annForm.tenants.split(",").map((t) => t.trim()).filter(Boolean) } : {}),
                  ...(localToIso(annForm.expires) ? { expires_at: localToIso(annForm.expires) } : {}),
                },
              })
            ).data
          }
          onDone={() => {
            setNotice("Draft saved. Publish it when ready.");
            announcements.reload();
          }}
        >
          <label className={styles.field}>
            Title
            <input className={styles.input} value={annForm.title} onChange={(e) => setAnnForm({ ...annForm, title: e.target.value })} />
          </label>
          <label className={styles.field}>
            Message
            <textarea className={styles.textarea} value={annForm.message} onChange={(e) => setAnnForm({ ...annForm, message: e.target.value })} />
          </label>
          <label className={styles.field}>
            Type
            <select className={styles.select} value={annForm.type} onChange={(e) => setAnnForm({ ...annForm, type: e.target.value })}>
              {["INFO", "FEATURE", "WARNING", "MAINTENANCE", "INCIDENT"].map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Audience
            <select className={styles.select} value={annForm.scope} onChange={(e) => setAnnForm({ ...annForm, scope: e.target.value })}>
              <option value="ALL_TENANTS">Every workspace</option>
              <option value="PLAN">Workspaces on these plans</option>
              <option value="TENANT_LIST">Named workspaces</option>
            </select>
          </label>
          {annForm.scope === "PLAN" && (
            <label className={styles.field}>
              Plan ids (comma-separated)
              <input className={styles.input} value={annForm.plans} onChange={(e) => setAnnForm({ ...annForm, plans: e.target.value })} />
            </label>
          )}
          {annForm.scope === "TENANT_LIST" && (
            <label className={styles.field}>
              Tenant ids (comma-separated)
              <input className={styles.input} value={annForm.tenants} onChange={(e) => setAnnForm({ ...annForm, tenants: e.target.value })} />
            </label>
          )}
          <label className={styles.field}>
            Stop showing after (optional)
            <input className={styles.input} type="datetime-local" value={annForm.expires} onChange={(e) => setAnnForm({ ...annForm, expires: e.target.value })} />
          </label>
        </PrivilegedActionDialog>
      ) : (
        <PermissionDenied resource="announcements" requiredPermission={PLATFORM_PERMISSIONS.ANNOUNCEMENT_CREATE} inline />
      ))}
    </>
  );
}
