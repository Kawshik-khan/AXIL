"use client";

import React, { useState } from "react";
import Link from "next/link";
import { BentoCard } from "@/components/bento/BentoCard";
import { PermissionDenied } from "@/components/ui/States/States";
import { findPrivilegedAction } from "@/domains/platform/privileged-actions";
import { PLATFORM_PERMISSIONS } from "@/lib/permissions";
import type { PlatformAuditLogRecord } from "@/types/platform";
import { CONSOLE_ROOT } from "../../_lib/platform-module-access";
import { formatDateTime, formatRelative, humanize } from "../../_lib/format";
import type { ResourceState } from "../../_lib/use-platform-resource";
import { ResourceView } from "../ResourceView";
import { StatusPill } from "../StatusPill";
import consoleStyles from "../../super-admin.module.css";
import styles from "./control-tower.module.css";

function AuditTable({ logs }: { logs: readonly PlatformAuditLogRecord[] }) {
  return (
    <div className={styles.auditScroll}>
      <table className={`${consoleStyles.table} ${styles.auditTable}`}>
        <thead>
          <tr>
            <th>When</th>
            <th>Action</th>
            <th>Target</th>
            <th>Reason</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <td className={styles.nowrap}>
                {formatRelative(log.created_at)}
                <small>{formatDateTime(log.created_at)}</small>
              </td>
              <td>
                {findPrivilegedAction(log.action)?.label ?? humanize(log.action)}
                <small className={consoleStyles.mono}>{log.action}</small>
              </td>
              <td>
                {log.target_tenant_id ? (
                  <Link href={`${CONSOLE_ROOT}/tenants/${encodeURIComponent(log.target_tenant_id)}`} className={styles.auditLink}>
                    {log.target_tenant_id}
                  </Link>
                ) : (
                  `${humanize(log.resource_type)} ${log.resource_id}`
                )}
                <small>By {humanize(log.platform_role)}</small>
              </td>
              <td className={styles.auditReason}>{log.reason}</td>
              <td>
                <StatusPill status={log.result} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type ResultFilter = "ALL" | PlatformAuditLogRecord["result"];
const FILTERS: Array<[ResultFilter, string]> = [
  ["ALL", "All"],
  ["SUCCESS", "Success"],
  ["BLOCKED", "Blocked"],
  ["FAILED", "Failed"],
];
const SHOWN = 8;

/** The newest platform audit entries, filtered by result on this page only. */
export const AuditCard: React.FC<{ canRead: boolean; state: ResourceState<PlatformAuditLogRecord[]>; onRetry: () => void }> = ({
  canRead,
  state,
  onRetry,
}) => {
  const [result, setResult] = useState<ResultFilter>("ALL");
  return (
    <BentoCard
      span={12}
      className={`${styles.card} ${styles.pillInk} ${styles.audit}`}
      title="Privileged actions"
      subtitle="Latest entries in the platform audit log"
      action={
        canRead ? (
          <div className={styles.auditTools}>
            <div className={`${styles.pills} ${styles.pillsInset}`} role="group" aria-label="Filter by result">
              {FILTERS.map(([id, label]) => (
                <button key={id} type="button" aria-pressed={result === id} onClick={() => setResult(id)}>
                  {label}
                </button>
              ))}
            </div>
            <Link href={`${CONSOLE_ROOT}/audit`} className={styles.softButton}>
              Open audit
            </Link>
          </div>
        ) : undefined
      }
    >
      {canRead ? (
        <ResourceView
          state={state}
          onRetry={onRetry}
          resource="the audit log"
          emptyFigure="log-empty"
          emptyTitle="No privileged actions yet"
          emptyDescription="Platform actions such as suspensions, plan changes and kill switches will appear here."
          renderReady={(logs) => {
            const rows = logs.filter((l) => result === "ALL" || l.result === result).slice(0, SHOWN);
            return rows.length > 0 ? <AuditTable logs={rows} /> : <p className={styles.small}>No entries with this result among the latest {logs.length}.</p>;
          }}
        />
      ) : (
        <PermissionDenied resource="the audit log" requiredPermission={PLATFORM_PERMISSIONS.AUDIT_READ} inline />
      )}
    </BentoCard>
  );
};
