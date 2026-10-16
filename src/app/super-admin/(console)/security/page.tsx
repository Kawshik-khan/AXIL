"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { PLATFORM_PERMISSIONS } from "@/lib/permissions";
import type { ApprovalView } from "@/domains/platform/services/platform-approval.service";
import type { ImpersonationSessionRecord } from "@/types/platform";
import { usePlatformResource } from "../../_lib/use-platform-resource";
import { usePlatformSession } from "../../_lib/platform-session";
import { PlatformApiError, platformRequest } from "../../_lib/platform-client";
import { formatCountdown, formatDateTime, humanize } from "../../_lib/format";
import { CONSOLE_ROOT } from "../../_lib/platform-module-access";
import { PageHeader } from "../../_components/PageHeader";
import { ResourceView } from "../../_components/ResourceView";
import { StatusPill } from "../../_components/StatusPill";
import { Tabs, useTab, type TabDef } from "../../_components/Tabs";
import { PrivilegedActionDialog } from "../../_components/PrivilegedActionDialog";
import styles from "../../super-admin.module.css";

type TabId = "approvals" | "operators" | "support" | "compliance";

interface Operator {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: string;
  mfa_enabled: boolean;
  is_active: boolean;
  status: string;
  updated_at: string;
}

const ROLES = ["SUPER_ADMIN", "PLATFORM_ADMIN", "PLATFORM_OPERATIONS", "PLATFORM_SUPPORT", "PLATFORM_FINANCE", "PLATFORM_SECURITY", "PLATFORM_ANALYST"];

/** Where a request's action is run once approved. */
function runPath(a: ApprovalView): string {
  switch (a.target_type) {
    case "tenant":
      return `${CONSOLE_ROOT}/tenants/${encodeURIComponent(a.target_tenant_id ?? a.target_id)}`;
    case "kill_switch":
      return `${CONSOLE_ROOT}/safety`;
    case "operator":
      return `${CONSOLE_ROOT}/security?tab=operators`;
    case "plan_version":
      return `${CONSOLE_ROOT}/billing?tab=migrate`;
    default:
      return CONSOLE_ROOT;
  }
}

export default function SecurityPage() {
  const { can, session } = usePlatformSession();
  const tabs: TabDef<TabId>[] = [
    { id: "approvals", label: "Approvals" },
    { id: "operators", label: "Operators" },
    { id: "support", label: "Support sessions", visible: can(PLATFORM_PERMISSIONS.SUPPORT_READ) },
    { id: "compliance", label: "Compliance export", visible: can(PLATFORM_PERMISSIONS.TENANT_READ) },
  ];
  const [tab, setTab] = useTab(tabs, "approvals");
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [decide, setDecide] = useState<{ approval: ApprovalView; decision: "APPROVE" | "REJECT" } | null>(null);
  const [note, setNote] = useState("");
  const [roleChange, setRoleChange] = useState<{ userId: string; label: string; current?: string } | null>(null);
  const [newRole, setNewRole] = useState("");
  const [grantUserId, setGrantUserId] = useState("");
  const [exportTenant, setExportTenant] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportResult, setExportResult] = useState<{ checksum: string; manifest: Record<string, number>; name: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const approvals = usePlatformResource<ApprovalView[]>(
    tab === "approvals" ? `/api/v1/platform/approvals?limit=200${statusFilter ? `&status=${statusFilter}` : ""}` : null,
    { isEmpty: (l) => l.length === 0, refreshMs: 30_000 }
  );
  const operators = usePlatformResource<Operator[]>(tab === "operators" || tab === "approvals" ? "/api/v1/platform/users" : null);
  const sessions = usePlatformResource<ImpersonationSessionRecord[]>(tab === "support" ? "/api/v1/platform/support/impersonate" : null, { isEmpty: (l) => l.length === 0 });
  const tenants = usePlatformResource<Array<{ id: string; name: string }>>(tab === "compliance" ? "/api/v1/platform/tenants?limit=200" : null);

  const operatorName = useMemo(() => {
    const map = new Map<string, string>();
    if (operators.state.kind === "ready") for (const o of operators.state.data) map.set(o.user_id, o.name || o.email);
    return (id: string) => (id === session.user.id ? "You" : map.get(id) ?? id);
  }, [operators.state, session.user.id]);

  const revoke = async (s: ImpersonationSessionRecord) => {
    setError(null);
    try {
      await platformRequest(`/api/v1/platform/support/impersonate?sessionId=${encodeURIComponent(s.id)}&reason=${encodeURIComponent("Ended from the Security console")}`, { method: "DELETE" });
      setNotice("Support session ended.");
      sessions.reload();
    } catch (err) {
      setError(err instanceof PlatformApiError ? err.message : "Could not end the session.");
    }
  };

  const withdraw = async (a: ApprovalView) => {
    setError(null);
    try {
      await platformRequest(`/api/v1/platform/approvals/${encodeURIComponent(a.id)}/cancel`, { method: "POST" });
      setNotice("Request withdrawn.");
      approvals.reload();
    } catch (err) {
      setError(err instanceof PlatformApiError ? err.message : "Could not withdraw the request.");
    }
  };

  return (
    <>
      <PageHeader
        title="Security"
        description="Two-person approvals, operator roles and MFA, support sessions and compliance exports."
        actions={
          <Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={() => { approvals.reload(); operators.reload(); sessions.reload(); }}>
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

      {tab === "approvals" && (
        <BentoCard span={12} title="Approval requests" subtitle="CRITICAL actions run only after a second operator approves the exact input"
          action={
            <select className={styles.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="EXECUTED">Executed</option>
              <option value="REJECTED">Rejected</option>
              <option value="EXPIRED">Expired</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="">All</option>
            </select>
          }
        >
          <ResourceView
            state={approvals.state}
            onRetry={approvals.reload}
            resource="approval requests"
            emptyFigure="queue-empty"
            emptyTitle={statusFilter === "PENDING" ? "Nothing waiting for approval" : "No requests"}
            emptyDescription="Requests appear when an operator asks for a second pair of eyes on a CRITICAL action."
            renderReady={(rows) => (
              <ul className={styles.list}>
                {rows.map((a) => (
                  <li key={a.id} className={styles.listRow}>
                    <span className={styles.rowMain}>
                      <span className={styles.rowTitle}>
                        {a.action_label} · {a.target_label}
                      </span>
                      <span className={styles.rowMeta}>
                        Requested by {operatorName(a.requested_by)} ({humanize(a.requested_by_role)}) {formatDateTime(a.requested_at)} · {a.reason}
                        {a.ticket_ref ? ` · ticket ${a.ticket_ref}` : ""}
                      </span>
                      <span className={styles.mono}>{JSON.stringify(a.payload)}</span>
                      {a.decided_by && (
                        <span className={styles.rowMeta}>
                          {humanize(a.effective_status)} by {operatorName(a.decided_by)} {formatDateTime(a.decided_at)}
                          {a.decision_note ? `: ${a.decision_note}` : ""}
                        </span>
                      )}
                    </span>
                    <span className={styles.inlineActions}>
                      <StatusPill status={a.risk} tone={a.risk === "CRITICAL" || a.risk === "HIGH" ? "bad" : "warn"} />
                      <StatusPill status={a.effective_status} />
                      {(a.effective_status === "PENDING" || a.effective_status === "APPROVED") && <span className={styles.asOf}>{formatCountdown(a.expires_at)}</span>}
                      {a.can_decide && (
                        <>
                          <Button size="sm" onClick={() => { setNote(""); setDecide({ approval: a, decision: "APPROVE" }); }}>
                            Approve
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => { setNote(""); setDecide({ approval: a, decision: "REJECT" }); }}>
                            Reject
                          </Button>
                        </>
                      )}
                      {a.can_execute && (
                        <Link href={runPath(a)} className={styles.asOf}>
                          Run it
                        </Link>
                      )}
                      {a.requested_by === session.user.id && (a.effective_status === "PENDING" || a.effective_status === "APPROVED") && (
                        <Button size="sm" variant="ghost" onClick={() => withdraw(a)}>
                          Withdraw
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          />
          {!can(PLATFORM_PERMISSIONS.APPROVAL_DECIDE) && (
            <span className={styles.hint}>Your role can request approvals but not decide them.</span>
          )}
        </BentoCard>
      )}

      {tab === "operators" && (
        <BentoGrid>
          <BentoCard span={12} title="Platform operators" subtitle="Role changes are CRITICAL: step-up, a ticket and a second operator; nobody changes their own role">
            <ResourceView
              state={operators.state}
              onRetry={operators.reload}
              resource="operators"
              emptyFigure="empty-list"
              emptyTitle="No operators"
              emptyDescription="Operators are platform staff with a role; they never become workspace members."
              renderReady={(rows) => (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Operator</th>
                        <th>Role</th>
                        <th>MFA</th>
                        <th>Account</th>
                        <th>Updated</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((o) => (
                        <tr key={o.id}>
                          <td>
                            <span className={styles.rowMain}>
                              <span className={styles.rowTitle}>
                                {o.name}
                                {o.user_id === session.user.id ? " (you)" : ""}
                              </span>
                              <span className={styles.rowMeta}>{o.email}</span>
                            </span>
                          </td>
                          <td>{humanize(o.role)}</td>
                          <td>
                            <StatusPill status={o.mfa_enabled ? "ENABLED" : "PENDING"} tone={o.mfa_enabled ? "ok" : "warn"} label={o.mfa_enabled ? "Enrolled" : "Not enrolled"} />
                          </td>
                          <td>
                            <StatusPill status={o.is_active ? "ACTIVE" : "DISABLED"} />
                          </td>
                          <td>{formatDateTime(o.updated_at)}</td>
                          <td>
                            {can(PLATFORM_PERMISSIONS.SECURITY_MANAGE) && o.user_id !== session.user.id && (
                              <Button size="sm" variant="outline" onClick={() => { setNewRole(""); setRoleChange({ userId: o.user_id, label: o.name || o.email, current: o.role }); }}>
                                Change role
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
          {can(PLATFORM_PERMISSIONS.SECURITY_MANAGE) && (
            <BentoCard span={12} title="Give an existing account operator access" subtitle="The account must already exist; a platform role never makes it a workspace member">
              <div className={styles.toolbar}>
                <input className={styles.input} placeholder="User id" value={grantUserId} onChange={(e) => setGrantUserId(e.target.value.trim())} aria-label="User id" />
                <Button size="sm" variant="outline" disabled={!grantUserId} onClick={() => { setNewRole(""); setRoleChange({ userId: grantUserId, label: grantUserId }); }}>
                  Choose role
                </Button>
              </div>
            </BentoCard>
          )}
        </BentoGrid>
      )}

      {tab === "support" && (
        <BentoCard span={12} title="Support sessions" subtitle="Read-only views of workspaces; each request inside one is logged">
          <ResourceView
            state={sessions.state}
            onRetry={sessions.reload}
            resource="support sessions"
            emptyFigure="log-empty"
            emptyTitle="No support sessions"
            emptyDescription="Start one from a tenant's page."
            renderReady={(rows) => (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>Operator</th>
                      <th>Workspace</th>
                      <th>Reason</th>
                      <th>Mode</th>
                      <th>Ends</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows
                      .slice()
                      .sort((a, b) => b.created_at.localeCompare(a.created_at))
                      .map((s) => {
                        const live = !s.revoked_at && Date.parse(s.expires_at) > Date.now();
                        return (
                          <tr key={s.id}>
                            <td>{formatDateTime(s.created_at)}</td>
                            <td>{operatorName(s.operator_user_id)}</td>
                            <td>
                              <Link href={`${CONSOLE_ROOT}/tenants/${encodeURIComponent(s.target_tenant_id)}`}>{s.target_tenant_id}</Link>
                            </td>
                            <td>
                              {s.reason}
                              {s.ticket_reference ? ` · ${s.ticket_reference}` : ""}
                            </td>
                            <td>{humanize(s.mode)}</td>
                            <td>{s.revoked_at ? `Ended ${formatDateTime(s.revoked_at)}` : live ? formatCountdown(s.expires_at) : "Expired"}</td>
                            <td>
                              {live && can(PLATFORM_PERMISSIONS.SUPPORT_IMPERSONATE) && (
                                <Button size="sm" variant="ghost" onClick={() => revoke(s)}>
                                  End now
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

      {tab === "compliance" && (
        <BentoCard span={12} title="Tenant data export" subtitle="Orders, products, customers and platform audit for one workspace, with a SHA-256 checksum. Contains customer PII.">
          <div className={styles.sectionGap}>
            <div className={styles.toolbar}>
              <select className={styles.select} value={exportTenant} onChange={(e) => setExportTenant(e.target.value)} aria-label="Workspace">
                <option value="">Choose a workspace</option>
                {tenants.state.kind === "ready" &&
                  tenants.state.data.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
              <Button size="sm" variant="outline" disabled={!exportTenant} onClick={() => setExportOpen(true)}>
                Export
              </Button>
            </div>
            {exportResult && (
              <dl className={styles.definition}>
                <dt>Workspace</dt>
                <dd>{exportResult.name}</dd>
                <dt>Records</dt>
                <dd>{Object.entries(exportResult.manifest).map(([k, v]) => `${humanize(k)} ${v}`).join(" · ")}</dd>
                <dt>SHA-256</dt>
                <dd className={styles.mono}>{exportResult.checksum}</dd>
              </dl>
            )}
          </div>
        </BentoCard>
      )}

      {/* ---------- Dialogs ---------- */}
      {decide && (
        <PrivilegedActionDialog
          open
          onClose={() => setDecide(null)}
          actionKey="approval.decide"
          submitLabel={decide.decision === "APPROVE" ? "Approve" : "Reject"}
          target={{ type: "platform", id: decide.approval.id, label: `${decide.approval.action_label} · ${decide.approval.target_label}` }}
          canSubmit={decide.decision === "APPROVE" || note.trim().length >= 10}
          execute={async (a) =>
            (
              await platformRequest(
                `/api/v1/platform/approvals/${encodeURIComponent(decide.approval.id)}/decision`,
                { method: "POST", json: { decision: decide.decision, ...(note.trim() ? { note: note.trim() } : {}) } },
                a.stepUpToken
              )
            ).data
          }
          onDone={() => {
            setNotice(decide.decision === "APPROVE" ? "Approved. The requester can now run it once." : "Rejected.");
            approvals.reload();
          }}
        >
          <dl className={styles.definition}>
            <dt>Requested by</dt>
            <dd>{operatorName(decide.approval.requested_by)}</dd>
            <dt>Reason</dt>
            <dd>{decide.approval.reason}</dd>
            <dt>Ticket</dt>
            <dd>{decide.approval.ticket_ref ?? "—"}</dd>
            <dt>Exact input</dt>
            <dd className={styles.mono}>{JSON.stringify(decide.approval.payload)}</dd>
          </dl>
          <label className={styles.field}>
            Note {decide.decision === "REJECT" ? "(required, 10+ characters)" : "(optional)"}
            <textarea className={styles.textarea} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </label>
        </PrivilegedActionDialog>
      )}

      {roleChange && (
        <PrivilegedActionDialog
          open
          onClose={() => setRoleChange(null)}
          actionKey="operator.assign_role"
          target={{ type: "operator", id: roleChange.userId, label: roleChange.label }}
          canSubmit={Boolean(newRole) && newRole !== roleChange.current}
          execute={async (a) =>
            (
              await platformRequest(
                "/api/v1/platform/users",
                {
                  method: "POST",
                  json: {
                    userId: roleChange.userId,
                    role: newRole,
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
            setNotice(`${roleChange.label} is now ${humanize(newRole)}.`);
            operators.reload();
          }}
        >
          {roleChange.current && <span className={styles.hint}>Current role: {humanize(roleChange.current)}</span>}
          <label className={styles.field}>
            New role
            <select className={styles.select} value={newRole} onChange={(e) => setNewRole(e.target.value)}>
              <option value="">Choose a role</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {humanize(r)}
                </option>
              ))}
            </select>
          </label>
        </PrivilegedActionDialog>
      )}

      <PrivilegedActionDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        actionKey="compliance.export"
        target={{ type: "tenant", id: exportTenant, label: tenants.state.kind === "ready" ? tenants.state.data.find((t) => t.id === exportTenant)?.name ?? exportTenant : exportTenant }}
        submitLabel="Generate export"
        execute={async (a) =>
          (await platformRequest<Record<string, unknown>>("/api/v1/platform/compliance/export", { method: "POST", json: { tenant_id: exportTenant } }, a.stepUpToken)).data
        }
        onDone={(r) => {
          const data = r as { tenant_name: string; tenant_slug: string; checksum_sha256: string; manifest: Record<string, number> };
          setExportResult({ checksum: data.checksum_sha256, manifest: data.manifest, name: data.tenant_name });
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `commerceos-export-${data.tenant_slug}-${new Date().toISOString().slice(0, 10)}.json`;
          link.click();
          URL.revokeObjectURL(url);
          setNotice("Export generated and downloaded. It contains customer personal data: store it securely.");
        }}
      >
        <span className={styles.hint}>The download contains customer names, phones and addresses. The export is audited with its checksum.</span>
      </PrivilegedActionDialog>
    </>
  );
}
