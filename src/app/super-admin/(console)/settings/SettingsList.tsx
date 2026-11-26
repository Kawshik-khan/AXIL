"use client";

import React from "react";
import { ChevronRight, Lock, Search, ShieldCheck } from "lucide-react";
import type { EffectiveSetting } from "@/domains/platform/services/platform-settings.service";
import type { ApprovalView } from "@/domains/platform/services/platform-approval.service";
import { humanize } from "../../_lib/format";
import { isChanged, isGoverned, showValue, type SettingFilter } from "./setting-view";
import consoleStyles from "../../super-admin.module.css";
import styles from "./settings.module.css";

const FILTERS: readonly { id: SettingFilter; label: string }[] = [
  { id: "ALL", label: "All" },
  { id: "CHANGED", label: "Changed" },
  { id: "GOVERNED", label: "Needs approval" },
  { id: "LOCKED", label: "Not in use" },
];

export interface SettingsListProps {
  groups: readonly (readonly [category: string, rows: EffectiveSetting[]])[];
  /** The caller's open requests, by setting key. */
  approvals: ReadonlyMap<string, ApprovalView>;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  query: string;
  onQuery: (q: string) => void;
  filter: SettingFilter;
  onFilter: (f: SettingFilter) => void;
  counts: Record<SettingFilter, number>;
  onReset: () => void;
  /** The approval requests could not be loaded, so rows can't show them. */
  approvalsUnavailable: boolean;
}

function Flag({ setting, approval }: { setting: EffectiveSetting; approval?: ApprovalView }) {
  if (approval) {
    return (
      <span className={`${styles.flag} ${approval.effective_status === "APPROVED" ? styles.flagApproved : styles.flagWaiting}`}>
        {approval.effective_status === "APPROVED" ? "Approved" : "Waiting for approval"}
      </span>
    );
  }
  if (!setting.editable) {
    return (
      <span className={styles.flag}>
        <Lock size={14} aria-hidden="true" />
        Not in use
      </span>
    );
  }
  if (isGoverned(setting)) {
    return (
      <span className={styles.flag}>
        <ShieldCheck size={14} aria-hidden="true" />
        Needs approval
      </span>
    );
  }
  return <span className={styles.flag} />;
}

/** The settings as one quiet list: name, a flag only when it matters, and the value in force. */
export const SettingsList: React.FC<SettingsListProps> = ({
  groups,
  approvals,
  selectedKey,
  onSelect,
  query,
  onQuery,
  filter,
  onFilter,
  counts,
  onReset,
  approvalsUnavailable,
}) => (
  <>
    <div className={styles.tools}>
      <label className={styles.find}>
        <Search size={16} aria-hidden="true" />
        <span className={consoleStyles.visuallyHidden}>Find a setting</span>
        <input type="search" placeholder="Find a setting or key" value={query} onChange={(e) => onQuery(e.target.value)} />
      </label>
      <div className={styles.segment} role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => onFilter(f.id)}>
            {f.label} <span className={styles.num}>{counts[f.id]}</span>
          </button>
        ))}
      </div>
    </div>

    {approvalsUnavailable && (
      <p className={styles.unavailable} role="status">
        Approval requests could not be loaded, so waiting changes are not marked. Refresh to try again.
      </p>
    )}

    {groups.length === 0 && (
      <div className={styles.none}>
        <strong>No settings match</strong>
        <span>Try another word, or show every setting.</span>
        <button type="button" className={styles.line} onClick={onReset}>
          Show all settings
        </button>
      </div>
    )}

    {groups.map(([category, rows]) => (
      <section key={category} aria-label={humanize(category)}>
        <h2 className={styles.group}>{humanize(category)}</h2>
        <ul className={styles.rows}>
          {rows.map((s) => (
            <li key={s.key}>
              <button type="button" data-setting={s.key} className={styles.row} aria-pressed={selectedKey === s.key} onClick={() => onSelect(s.key)}>
                <span className={styles.name}>{s.label}</span>
                <Flag setting={s} approval={approvals.get(s.key)} />
                <span className={`${styles.value} ${!s.editable || s.value === "" ? styles.valueQuiet : ""}`}>
                  {isChanged(s) && <span className={consoleStyles.visuallyHidden}>Changed from default: </span>}
                  {showValue(s.value, s.unit)}
                </span>
                <ChevronRight className={styles.go} size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    ))}
  </>
);
