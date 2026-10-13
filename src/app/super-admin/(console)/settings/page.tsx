"use client";

import React, { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { PLATFORM_PERMISSIONS } from "@/lib/permissions";
import type { EffectiveSetting } from "@/domains/platform/services/platform-settings.service";
import type { PlatformSettingVersionRecord } from "@/types/platform";
import { usePlatformResource } from "../../_lib/use-platform-resource";
import { usePlatformSession } from "../../_lib/platform-session";
import { platformRequest } from "../../_lib/platform-client";
import { formatDateTime, humanize } from "../../_lib/format";
import { PageHeader } from "../../_components/PageHeader";
import { ResourceView } from "../../_components/ResourceView";
import { StatusPill } from "../../_components/StatusPill";
import { PrivilegedActionDialog } from "../../_components/PrivilegedActionDialog";
import styles from "../../super-admin.module.css";

function show(value: unknown, unit?: string): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (value === null || value === undefined) return "—";
  return `${String(value)}${unit ? ` ${unit}` : ""}`;
}

/** Parses the form text into the type of the setting's default (number or boolean); strings pass through. */
function parseInput(text: string, like: unknown): unknown {
  if (typeof like === "boolean") return text === "true";
  if (typeof like === "number") return text.trim() === "" ? NaN : Number(text);
  return text;
}

export default function SettingsPage() {
  const { can } = usePlatformSession();
  const settings = usePlatformResource<EffectiveSetting[]>("/api/v1/platform/settings", { isEmpty: (s) => s.length === 0 });
  const [editing, setEditing] = useState<EffectiveSetting | null>(null);
  const [value, setValue] = useState("");
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const history = usePlatformResource<PlatformSettingVersionRecord[]>(historyKey ? `/api/v1/platform/settings?key=${encodeURIComponent(historyKey)}` : null, {
    isEmpty: (v) => v.length === 0,
  });

  const grouped = useMemo(() => {
    if (settings.state.kind !== "ready") return [];
    const map = new Map<string, EffectiveSetting[]>();
    for (const s of settings.state.data) map.set(s.category, [...(map.get(s.category) ?? []), s]);
    return [...map.entries()];
  }, [settings.state]);

  const parsed = editing ? parseInput(value, editing.default_value) : null;
  const valid = editing ? !(typeof parsed === "number" && Number.isNaN(parsed)) && JSON.stringify(parsed) !== JSON.stringify(editing.value) : false;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Every platform setting the code reads, with the value in force and where it comes from. Settings nothing reads are listed but locked."
        fetchedAt={settings.state.kind === "ready" ? settings.state.fetchedAt : undefined}
        actions={
          <Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={settings.reload}>
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

      <ResourceView
        state={settings.state}
        onRetry={settings.reload}
        resource="platform settings"
        emptyFigure="empty-list"
        emptyTitle="No settings registered"
        emptyDescription="Settings are declared in src/domains/platform/settings-registry.ts."
        renderReady={() => (
          <BentoGrid>
            {grouped.map(([category, rows]) => (
              <BentoCard key={category} span={12} title={humanize(category)}>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Setting</th>
                        <th>In force</th>
                        <th>From</th>
                        <th>Risk</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((s) => (
                        <tr key={s.key}>
                          <td>
                            <span className={styles.rowMain}>
                              <span className={styles.rowTitle}>{s.label}</span>
                              <span className={styles.rowMeta}>
                                <code>{s.key}</code> · {s.description}
                              </span>
                              <span className={styles.rowMeta}>{s.read_by ? `Read by ${s.read_by}` : "Not read by any code yet"}</span>
                            </span>
                          </td>
                          <td>{show(s.value, s.unit)}</td>
                          <td>{s.source === "STORED" ? `Changed ${formatDateTime(s.updated_at)}` : `Code default (${show(s.default_value, s.unit)})`}</td>
                          <td>
                            <StatusPill status={s.risk} tone={s.risk === "CRITICAL" || s.risk === "HIGH" ? "bad" : s.risk === "MEDIUM" ? "warn" : "neutral"} />
                          </td>
                          <td>
                            <div className={styles.inlineActions}>
                              {s.editable ? (
                                can(PLATFORM_PERMISSIONS.PLATFORM_CONFIG_MANAGE) && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setValue(typeof s.value === "boolean" ? String(s.value) : String(s.value ?? ""));
                                      setEditing(s);
                                    }}
                                  >
                                    Change
                                  </Button>
                                )
                              ) : (
                                <StatusPill status="SIMULATED" label="Locked" />
                              )}
                              <Button size="sm" variant="ghost" onClick={() => setHistoryKey(historyKey === s.key ? null : s.key)}>
                                History
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {historyKey && rows.some((r) => r.key === historyKey) && (
                  <ResourceView
                    state={history.state}
                    onRetry={history.reload}
                    resource="setting history"
                    emptyFigure="log-empty"
                    emptyTitle="Never changed"
                    emptyDescription="The code default has always applied."
                    renderReady={(versions) => (
                      <ul className={styles.list}>
                        {versions
                          .slice()
                          .reverse()
                          .map((v) => (
                            <li key={v.id} className={styles.listRow}>
                              <span className={styles.rowMain}>
                                <span>
                                  {show(v.value)} · {formatDateTime(v.created_at)}
                                </span>
                                <span className={styles.rowMeta}>
                                  {v.changed_by_user_id}: {v.reason}
                                </span>
                              </span>
                              {can(PLATFORM_PERMISSIONS.PLATFORM_CONFIG_MANAGE) && rows.find((r) => r.key === historyKey)?.editable && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    const s = rows.find((r) => r.key === historyKey)!;
                                    setValue(typeof v.value === "boolean" ? String(v.value) : String(v.value ?? ""));
                                    setEditing(s);
                                  }}
                                >
                                  Restore this value
                                </Button>
                              )}
                            </li>
                          ))}
                      </ul>
                    )}
                  />
                )}
              </BentoCard>
            ))}
          </BentoGrid>
        )}
      />

      {editing && (
        <PrivilegedActionDialog
          open
          onClose={() => setEditing(null)}
          actionKey={editing.risk === "HIGH" || editing.risk === "CRITICAL" ? "platform_config.update_governed" : "platform_config.update"}
          target={{ type: "platform", id: editing.key, label: editing.label }}
          canSubmit={valid}
          execute={async (a) =>
            (await platformRequest("/api/v1/platform/settings", { method: "POST", json: { key: editing.key, value: parsed, reason: a.reason, ...(a.ticketRef ? { ticket_ref: a.ticketRef } : {}), ...(a.approvalId ? { approval_id: a.approvalId } : {}) } }, a.stepUpToken)).data
          }
          onDone={() => {
            setNotice(`${editing.label} updated. It takes effect on the next request that reads it.`);
            settings.reload();
            history.reload();
          }}
        >
          <span className={styles.hint}>
            {editing.description} In force: {show(editing.value, editing.unit)}. Code default: {show(editing.default_value, editing.unit)}.
          </span>
          <label className={styles.field}>
            New value {editing.unit ? `(${editing.unit})` : ""}
            {typeof editing.default_value === "boolean" ? (
              <select className={styles.select} value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="true">On</option>
                <option value="false">Off</option>
              </select>
            ) : (
              <input className={styles.input} inputMode={typeof editing.default_value === "number" ? "decimal" : undefined} value={value} onChange={(e) => setValue(e.target.value)} />
            )}
            <span className={styles.hint}>The server checks the value against the setting&apos;s allowed range.</span>
          </label>
        </PrivilegedActionDialog>
      )}
    </>
  );
}
