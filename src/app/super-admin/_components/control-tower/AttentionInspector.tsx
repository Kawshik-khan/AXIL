"use client";

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { AttentionItem } from "@/domains/platform/services/platform-attention.service";
import { canAccessPlatformPath, requiredPlatformPermission } from "../../_lib/platform-module-access";
import { formatCount, humanize } from "../../_lib/format";
import { usePlatformResource } from "../../_lib/use-platform-resource";
import { usePlatformSession } from "../../_lib/platform-session";
import { ResourceView } from "../ResourceView";
import { actionsFor, ageLabel, categoryLabel, ctaLabel, recordsUrl, requirementsOf, toRecords } from "./control-tower-view";
import { SeverityTag } from "./SeverityMark";
import styles from "./control-tower.module.css";

const MAX_RECORDS = 5;

const CHANGED = "These records have changed since the list was worked out. Refresh to see the current state.";

/** The rows behind one item, from the module's own read route (which checks the permission). */
function Records({ item, url, asOf }: { item: AttentionItem; url: string; asOf: string }) {
  const { state, reload } = usePlatformResource<unknown>(url, { isEmpty: (data) => toRecords(item, data).length === 0 });

  // Every refresh of the list reads its records again, so the two never drift apart
  const loadedFor = useRef(asOf);
  useEffect(() => {
    if (loadedFor.current === asOf) return;
    loadedFor.current = asOf;
    reload();
  }, [asOf, reload]);

  // The list can change between the two reads; one plain line, not an illustrated empty state
  if (state.kind === "empty") return <p className={styles.small}>{CHANGED}</p>;

  return (
    <ResourceView
      state={state}
      onRetry={reload}
      resource="the records behind this item"
      emptyFigure="no-data"
      emptyTitle="No records"
      emptyDescription="Refresh to see the current state."
      skeletonLines={2}
      renderReady={(data) => {
        const records = toRecords(item, data);
        if (records.length === 0) return <p className={styles.small}>{CHANGED}</p>; // they expired while shown
        const more = Math.max(records.length, item.count ?? 0) - MAX_RECORDS;
        return (
          <ul className={styles.records}>
            {records.slice(0, MAX_RECORDS).map((r) => (
              <li key={r.id}>
                <strong>{r.title}</strong>
                <span>{r.when}</span>
                <small>{r.note}</small>
              </li>
            ))}
            {more > 0 && (
              <li>
                <small>{formatCount(more)} more in the module</small>
              </li>
            )}
          </ul>
        );
      }}
    />
  );
}

/** What acting on the item takes, from the registry the server enforces. The console shows it; it decides nothing. */
function Needs({ item }: { item: AttentionItem }) {
  const { can } = usePlatformSession();
  const actions = actionsFor(item);
  if (actions.length === 0) {
    return (
      <div className={styles.needs}>
        <h4>{item.id === "operators:no_mfa" ? "To resolve it" : "What you can see"}</h4>
        <p className={styles.small}>
          {item.id === "operators:no_mfa"
            ? "The operator sets up an authenticator from their own account menu. Nobody else can do it for them."
            : "The console has no list of security events yet, only this count and the latest one. The audit log shows the privileged actions around that time."}
        </p>
      </div>
    );
  }
  return (
    <div className={styles.needs}>
      <h4>{actions.length === 1 ? "To act on it" : "Ways to act on it"}</h4>
      <ul>
        {actions.map((spec) => {
          const needs = requirementsOf(spec);
          return (
            <li key={spec.key}>
              <span className={styles.needTitle}>
                {spec.label}
                <em>{humanize(spec.risk)} risk</em>
              </span>
              <span className={styles.small}>
                {needs.length > 0 ? `Asks for: ${needs.join(", ")}.` : "Asks for nothing more."}{" "}
                {can(spec.permission) ? (
                  item.category === "APPROVAL" ? (
                    "Each request also needs the permission of its own action."
                  ) : (
                    "Your role has the permission."
                  )
                ) : (
                  <>
                    Your role is missing <code>{spec.permission}</code>.
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface AttentionInspectorProps {
  item: AttentionItem;
  /** When the list was read; the records are read again whenever it changes. */
  asOf: string;
}

/** Everything about the selected item: what it is, the records behind it, what acting takes, and where to go. */
export const AttentionInspector: React.FC<AttentionInspectorProps> = ({ item, asOf }) => {
  const { session } = usePlatformSession();
  const url = recordsUrl(item);
  const open = canAccessPlatformPath(item.href, session.permissions);

  return (
    <div className={styles.inspector}>
      <div className={styles.inspectorMeta}>
        <SeverityTag severity={item.severity} />
        <span>
          {categoryLabel(item)} · {ageLabel(item)}
        </span>
      </div>
      <div>
        <h3>{item.title}</h3>
        <p className={styles.inspectorDetail}>{item.detail}</p>
      </div>
      {/* keyed, so one item's records never show under another while the next ones load */}
      {url && <Records key={item.id} item={item} url={url} asOf={asOf} />}
      <Needs item={item} />
      {open ? (
        <Link href={item.href} className={styles.inspectorAction}>
          {ctaLabel(item)}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      ) : (
        <p className={styles.small}>
          Your role can&#39;t open this module. Missing permission: <code>{requiredPlatformPermission(item.href)}</code>
        </p>
      )}
    </div>
  );
};
