import React from "react";
import Link from "next/link";
import { BentoCard } from "@/components/bento/BentoCard";
import { PermissionDenied } from "@/components/ui/States/States";
import { findPrivilegedAction } from "@/domains/platform/privileged-actions";
import { PLATFORM_PERMISSIONS } from "@/lib/permissions";
import type { PlatformAuditLogRecord } from "@/types/platform";
import { CONSOLE_ROOT } from "../../_lib/platform-module-access";
import { formatDhakaTime, humanize } from "../../_lib/format";
import type { ResourceState } from "../../_lib/use-platform-resource";
import { ResourceView } from "../ResourceView";
import styles from "./control-tower.module.css";

const dhakaDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(d);

/** Today's privileged actions (Dhaka date) as a timeline: the newest in lime, refusals in red, the rest lavender. */
export const TodayCard: React.FC<{ canRead: boolean; state: ResourceState<PlatformAuditLogRecord[]>; onRetry: () => void }> = ({
  canRead,
  state,
  onRetry,
}) => (
  <BentoCard
    span={3}
    className={`${styles.card} ${styles.today}`}
    title="Privileged today"
    subtitle="Dhaka time"
    action={
      canRead ? (
        <Link href={`${CONSOLE_ROOT}/audit`} className={styles.softButton}>
          Open audit
        </Link>
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
        emptyDescription="Suspensions, plan changes and kill switches appear here."
        skeletonLines={3}
        renderReady={(logs) => {
          const today = dhakaDay(new Date());
          const rows = logs.filter((l) => dhakaDay(new Date(l.created_at)) === today);
          if (rows.length === 0) return <p className={styles.small}>No privileged actions today.</p>;
          return (
            <ol className={styles.timeline}>
              {rows.map((l, i) => (
                <li key={l.id}>
                  <time dateTime={l.created_at}>{formatDhakaTime(new Date(l.created_at))}</time>
                  <div className={l.result !== "SUCCESS" ? styles.eventRefused : i === 0 ? styles.eventNewest : styles.event}>
                    <b>{findPrivilegedAction(l.action)?.label ?? humanize(l.action)}</b>
                    <span>{l.result !== "SUCCESS" ? humanize(l.result) : l.target_tenant_id ?? humanize(l.resource_type)}</span>
                  </div>
                </li>
              ))}
            </ol>
          );
        }}
      />
    ) : (
      <PermissionDenied resource="the audit log" requiredPermission={PLATFORM_PERMISSIONS.AUDIT_READ} inline />
    )}
  </BentoCard>
);
