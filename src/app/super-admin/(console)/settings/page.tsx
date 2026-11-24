"use client";

import React, { useCallback, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { PLATFORM_PERMISSIONS } from "@/lib/permissions";
import type { EffectiveSetting } from "@/domains/platform/services/platform-settings.service";
import type { ApprovalView } from "@/domains/platform/services/platform-approval.service";
import type { SettingCategory } from "@/domains/platform/settings-registry";
import { humanize } from "../../_lib/format";
import { usePlatformResource } from "../../_lib/use-platform-resource";
import { usePlatformSession } from "../../_lib/platform-session";
import { PageHeader } from "../../_components/PageHeader";
import { ResourceView } from "../../_components/ResourceView";
import { Tabs, useTab, type TabDef } from "../../_components/Tabs";
import { ChangeSettingDialog } from "./ChangeSettingDialog";
import { SettingInspector } from "./SettingInspector";
import { SettingsList } from "./SettingsList";
import { matchesFilter, matchesQuery, SETTING_CATEGORIES, type SettingFilter } from "./setting-view";
import consoleStyles from "../../super-admin.module.css";
import styles from "./settings.module.css";

type TabId = "ALL" | SettingCategory;

const TABS: readonly TabDef<TabId>[] = [{ id: "ALL", label: "All" }, ...SETTING_CATEGORIES.map((c) => ({ id: c, label: humanize(c) }))];

export default function SettingsPage() {
  const { can, session } = usePlatformSession();
  const canManage = can(PLATFORM_PERMISSIONS.PLATFORM_CONFIG_MANAGE);
  const settings = usePlatformResource<EffectiveSetting[]>("/api/v1/platform/settings", { isEmpty: (s) => s.length === 0 });
  // Only marks rows that are waiting; a failure here must not hide the settings
  const requests = usePlatformResource<ApprovalView[]>(canManage && can(PLATFORM_PERMISSIONS.PLATFORM_READ) ? "/api/v1/platform/approvals?limit=200" : null, {
    refreshMs: 30_000, // a request can be decided or expire while this page is open
  });

  const [tab, setTab] = useTab<TabId>(TABS, "ALL");
  const [filter, setFilter] = useState<SettingFilter>("ALL");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editing, setEditing] = useState<{ key: string; value: unknown } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [historyNonce, setHistoryNonce] = useState(0);

  const all = useMemo(() => (settings.state.kind === "ready" ? settings.state.data : []), [settings.state]);

  // The caller's own open requests: the ones they can run or withdraw
  const approvals = useMemo(() => {
    const map = new Map<string, ApprovalView>();
    if (requests.state.kind !== "ready") return map;
    for (const r of requests.state.data) {
      const open = r.effective_status === "PENDING" || r.effective_status === "APPROVED";
      if (!open || r.action_key !== "platform_config.update_governed" || r.requested_by !== session.user.id) continue;
      const known = map.get(r.target_id);
      if (!known || (known.effective_status === "PENDING" && r.effective_status === "APPROVED")) map.set(r.target_id, r);
    }
    return map;
  }, [requests.state, session.user.id]);

  const inTab = useMemo(() => all.filter((s) => tab === "ALL" || s.category === tab), [all, tab]);
  const counts = useMemo(() => {
    const count = (f: SettingFilter) => inTab.filter((s) => matchesFilter(s, f)).length;
    return { ALL: inTab.length, CHANGED: count("CHANGED"), GOVERNED: count("GOVERNED"), LOCKED: count("LOCKED") };
  }, [inTab]);
  const groups = useMemo(() => {
    const visible = inTab.filter((s) => matchesFilter(s, filter) && matchesQuery(s, query));
    return SETTING_CATEGORIES.map((c) => [c, visible.filter((s) => s.category === c)] as const).filter(([, rows]) => rows.length > 0);
  }, [inTab, filter, query]);
  const tabs = useMemo(
    () => (all.length === 0 ? TABS : TABS.map((t) => ({ ...t, count: t.id === "ALL" ? all.length : all.filter((s) => s.category === t.id).length }))),
    [all]
  );

  const selected = all.find((s) => s.key === selectedKey) ?? groups[0]?.[1][0] ?? all[0];
  const editingSetting = editing ? all.find((s) => s.key === editing.key) : undefined;

  const { reload: reloadSettings } = settings;
  const { reload: reloadRequests } = requests;
  const refresh = useCallback(() => {
    reloadSettings();
    reloadRequests();
    setHistoryNonce((n) => n + 1);
  }, [reloadSettings, reloadRequests]);

  const select = (key: string) => {
    setSelectedKey(key);
    if (!window.matchMedia("(max-width: 1024px)").matches) return;
    setDetailOpen(true);
    window.scrollTo({ top: 0 });
  };
  const back = () => {
    setDetailOpen(false);
    const key = selected?.key;
    if (key) window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-setting="${CSS.escape(key)}"]`)?.focus());
  };
  const showDetail = detailOpen && settings.state.kind === "ready"; // never hide the header of an error state

  return (
    <>
      <div className={showDetail ? styles.hiddenWithDetail : undefined}>
        <PageHeader
          title="Settings"
          description="Every platform setting the code reads, with the value in force and where it comes from. Settings nothing reads are listed but locked."
          fetchedAt={settings.state.kind === "ready" ? settings.state.fetchedAt : undefined}
          actions={
            <Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={refresh}>
              Refresh
            </Button>
          }
        />
      </div>
      <div className={showDetail ? styles.hiddenWithDetail : undefined}>
        <Tabs tabs={tabs} active={tab} onChange={setTab} />
      </div>

      {notice && (
        <div className={`${consoleStyles.banner} ${consoleStyles.bannerInfo}`} role="status">
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
        skeletonLines={8}
        renderReady={() => (
          <BentoGrid className={`${styles.layout} ${showDetail ? styles.showDetail : ""}`}>
            <BentoCard span={8} className={styles.listCard}>
              <SettingsList
                groups={groups}
                approvals={approvals}
                selectedKey={selected?.key ?? null}
                onSelect={select}
                query={query}
                onQuery={setQuery}
                filter={filter}
                onFilter={setFilter}
                counts={counts}
                approvalsUnavailable={requests.state.kind === "error"}
                onReset={() => {
                  setQuery("");
                  setFilter("ALL");
                  setTab("ALL");
                }}
              />
            </BentoCard>
            <BentoCard span={4} className={styles.inspectorCard}>
              {selected && (
                <SettingInspector
                  setting={selected}
                  approval={approvals.get(selected.key)}
                  canManage={canManage}
                  historyNonce={historyNonce}
                  onChange={(value) => setEditing({ key: selected.key, value })}
                  onApprovalsChanged={(text) => {
                    setNotice(text);
                    reloadRequests();
                  }}
                  onBack={back}
                  focusOnOpen={showDetail}
                />
              )}
            </BentoCard>
          </BentoGrid>
        )}
      />

      {editing && editingSetting && (
        <ChangeSettingDialog
          setting={editingSetting}
          initialValue={editing.value}
          onClose={() => {
            setEditing(null);
            reloadRequests(); // the dialog may have requested or withdrawn an approval
          }}
          onDone={() => {
            setNotice(`${editingSetting.label} updated. It takes effect on the next request that reads it.`);
            refresh();
          }}
        />
      )}
    </>
  );
}
