"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, RefreshCw } from "lucide-react";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { PLATFORM_PERMISSIONS } from "@/lib/permissions";
import type { PlatformAuditLogRecord } from "@/types/platform";
import { usePlatformResource } from "../../_lib/use-platform-resource";
import { usePlatformSession } from "../../_lib/platform-session";
import { PlatformApiError, platformRequest } from "../../_lib/platform-client";
import { formatCount, formatDateTime, humanize } from "../../_lib/format";
import { CONSOLE_ROOT } from "../../_lib/platform-module-access";
import { PageHeader } from "../../_components/PageHeader";
import { ResourceView } from "../../_components/ResourceView";
import { StatusPill } from "../../_components/StatusPill";
import styles from "../../super-admin.module.css";

const PAGE_SIZE = 50;

export default function AuditPage() {
  const { can } = usePlatformSession();
  const [actor, setActor] = useState("");
  const [tenant, setTenant] = useState("");
  const [action, setAction] = useState("");
  const [applied, setApplied] = useState({ actor: "", tenant: "", action: "" });
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportInfo, setExportInfo] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setApplied({ actor: actor.trim(), tenant: tenant.trim(), action: action.trim() });
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(id);
  }, [actor, tenant, action]);

  const url = useMemo(() => {
    const q = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (applied.actor) q.set("actorId", applied.actor);
    if (applied.tenant) q.set("tenantId", applied.tenant);
    if (applied.action) q.set("action", applied.action);
    return `/api/v1/platform/audit?${q.toString()}`;
  }, [applied, offset]);

  const logs = usePlatformResource<PlatformAuditLogRecord[]>(url, { isEmpty: (l) => l.length === 0 });
  const total = logs.state.kind === "ready" ? Number(logs.state.meta?.total ?? 0) : 0;
  const filtered = Boolean(applied.actor || applied.tenant || applied.action);

  const exportLedger = async () => {
    setExporting(true);
    setExportInfo(null);
    try {
      const res = await platformRequest<{ export_id: string; checksum_sha256: string; record_count: number }>("/api/v1/platform/audit", {
        method: "POST",
        json: { ...(applied.tenant ? { tenantId: applied.tenant } : {}), limit: 10000 },
      });
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `platform-audit-${res.data.export_id}.json`;
      link.click();
      URL.revokeObjectURL(href);
      setExportInfo(`${formatCount(res.data.record_count)} records exported · SHA-256 ${res.data.checksum_sha256}`);
    } catch (err) {
      setExportInfo(err instanceof PlatformApiError ? `Export failed: ${err.message}` : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Audit"
        description="Every privileged platform action: who, what, why, and the state before and after."
        fetchedAt={logs.state.kind === "ready" ? logs.state.fetchedAt : undefined}
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={logs.reload}>
              Refresh
            </Button>
            {can(PLATFORM_PERMISSIONS.AUDIT_EXPORT) && (
              <Button size="sm" icon={<Download size={14} />} onClick={exportLedger} isLoading={exporting}>
                Export{applied.tenant ? " tenant" : ""} ledger
              </Button>
            )}
          </>
        }
      />
      {exportInfo && (
        <div className={`${styles.banner} ${styles.bannerInfo}`} role="status">
          <span className={styles.mono}>{exportInfo}</span>
        </div>
      )}

      <BentoCard span={12}>
        <div className={styles.toolbar}>
          <input className={styles.input} placeholder="Actor id" value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Actor id" />
          <input className={styles.input} placeholder="Tenant id" value={tenant} onChange={(e) => setTenant(e.target.value)} aria-label="Tenant id" />
          <input className={styles.input} placeholder="Action (e.g. tenant.suspend)" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action" />
          {logs.state.kind === "ready" && <span className={styles.asOf}>{formatCount(total)} entries</span>}
        </div>
        <ResourceView
          state={logs.state}
          onRetry={logs.reload}
          resource="the audit log"
          emptyFigure={filtered ? "filtered-out" : "log-empty"}
          emptyTitle={filtered ? "No entries match" : "No privileged actions yet"}
          emptyDescription={filtered ? "Change the filters." : "Platform actions are recorded here as they happen."}
          skeletonLines={8}
          renderReady={(rows) => (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Action</th>
                      <th>Actor</th>
                      <th>Target</th>
                      <th>Reason</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((l) => (
                      <React.Fragment key={l.id}>
                        <tr onClick={() => setOpen(open === l.id ? null : l.id)} aria-expanded={open === l.id}>
                          <td>{formatDateTime(l.created_at)}</td>
                          <td className={styles.mono}>{l.action}</td>
                          <td>
                            <span className={styles.rowMain}>
                              <span className={styles.mono}>{l.actor_id}</span>
                              <span className={styles.rowMeta}>{humanize(l.platform_role)}</span>
                            </span>
                          </td>
                          <td>
                            {l.target_tenant_id ? (
                              <Link href={`${CONSOLE_ROOT}/tenants/${encodeURIComponent(l.target_tenant_id)}`} onClick={(e) => e.stopPropagation()}>
                                {l.target_tenant_id}
                              </Link>
                            ) : (
                              <span className={styles.mono}>
                                {l.resource_type} {l.resource_id}
                              </span>
                            )}
                          </td>
                          <td>{l.reason}</td>
                          <td>
                            <StatusPill status={l.result} />
                          </td>
                        </tr>
                        {open === l.id && (
                          <tr>
                            <td colSpan={6}>
                              <dl className={styles.definition}>
                                <dt>Request</dt>
                                <dd className={styles.mono}>
                                  {l.request_id} · correlation {l.correlation_id}
                                </dd>
                                {l.impersonation_session_id && (
                                  <>
                                    <dt>Support session</dt>
                                    <dd className={styles.mono}>{l.impersonation_session_id}</dd>
                                  </>
                                )}
                                {l.error_message && (
                                  <>
                                    <dt>Error</dt>
                                    <dd>{l.error_message}</dd>
                                  </>
                                )}
                                <dt>Before</dt>
                                <dd className={styles.mono}>{l.before_state ? JSON.stringify(l.before_state) : "—"}</dd>
                                <dt>After</dt>
                                <dd className={styles.mono}>{l.after_state ? JSON.stringify(l.after_state) : "—"}</dd>
                              </dl>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.toolbar}>
                <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                  Newer
                </Button>
                <span className={styles.asOf}>
                  {formatCount(offset + 1)}–{formatCount(Math.min(offset + rows.length, total))} of {formatCount(total)}
                </span>
                <Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
                  Older
                </Button>
              </div>
            </>
          )}
        />
      </BentoCard>
    </>
  );
}
