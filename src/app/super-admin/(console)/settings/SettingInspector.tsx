"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Circle } from "lucide-react";
import type { EffectiveSetting } from "@/domains/platform/services/platform-settings.service";
import type { ApprovalView } from "@/domains/platform/services/platform-approval.service";
import { findPrivilegedAction } from "@/domains/platform/privileged-actions";
import type { PlatformSettingVersionRecord } from "@/types/platform";
import { Button } from "@/components/ui/Button/Button";
import { formatDateTime, humanize } from "../../_lib/format";
import { PlatformApiError, platformRequest } from "../../_lib/platform-client";
import { CONSOLE_ROOT } from "../../_lib/platform-module-access";
import { usePlatformResource } from "../../_lib/use-platform-resource";
import { usePlatformSession } from "../../_lib/platform-session";
import { ResourceView } from "../../_components/ResourceView";
import { actionKeyFor } from "./ChangeSettingDialog";
import { isChanged, sameValue, showValue } from "./setting-view";
import consoleStyles from "../../super-admin.module.css";
import styles from "./settings.module.css";

export interface SettingInspectorProps {
  setting: EffectiveSetting;
  /** The caller's open approval request for this setting, if any. */
  approval?: ApprovalView;
  canManage: boolean;
  /** Bumped after a change, so the history loads again. */
  historyNonce: number;
  onChange: (value: unknown) => void;
  onApprovalsChanged: (notice: string) => void;
  onBack: () => void;
  /** True on a narrow screen once a row was picked: this panel replaces the list, so focus moves to it. */
  focusOnOpen: boolean;
}

/** What the declared action asks for, read from the registry the server enforces. */
function requirements(setting: EffectiveSetting): string[] {
  const spec = findPrivilegedAction(actionKeyFor(setting));
  if (!spec) return [];
  return [
    ...(spec.stepUp ? ["Your authenticator code"] : []),
    ...(spec.reasonMin > 0 ? [`A reason, ${spec.reasonMin} characters or more`] : []),
    ...(spec.ticketRequired ? ["A ticket or incident reference"] : []),
    ...(spec.approval !== "never" ? ["Approval of the exact value"] : []),
  ];
}

function ApprovalBox({ setting, approval, canManage, onChange, onApprovalsChanged }: Pick<SettingInspectorProps, "setting" | "canManage" | "onChange" | "onApprovalsChanged"> & { approval: ApprovalView }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approved = approval.effective_status === "APPROVED";
  const requested = approval.payload?.value;

  const withdraw = async () => {
    setBusy(true);
    setError(null);
    try {
      await platformRequest(`/api/v1/platform/approvals/${encodeURIComponent(approval.id)}/cancel`, { method: "POST" });
      onApprovalsChanged("Approval request withdrawn."); // stays busy: the reload removes this box
    } catch (err) {
      setError(err instanceof PlatformApiError ? `${err.message}${err.requestId ? ` (request ${err.requestId})` : ""}` : "Could not withdraw the request.");
      setBusy(false);
    }
  };

  return (
    <div className={`${styles.approval} ${approved ? styles.approvalReady : ""}`}>
      <strong>{approved ? "Approved" : "Waiting for approval"}</strong>
      <span className={styles.num}>
        {showValue(setting.value, setting.unit)} to {showValue(requested, setting.unit)}. Expires {formatDateTime(approval.expires_at)}.
      </span>
      <div className={styles.approvalActions}>
        {approved && canManage && approval.can_execute ? (
          <Button size="sm" variant="outline" className={consoleStyles.inkButton} onClick={() => onChange(requested)}>
            Apply approved value
          </Button>
        ) : (
          <Link className={styles.line} href={`${CONSOLE_ROOT}/security?tab=approvals`}>
            Open approvals
          </Link>
        )}
        <Button size="sm" variant="ghost" onClick={withdraw} isLoading={busy}>
          Withdraw
        </Button>
      </div>
      {error && (
        <span className={consoleStyles.fieldError} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function History({ setting, canRestore, nonce, onChange }: { setting: EffectiveSetting; canRestore: boolean; nonce: number; onChange: (value: unknown) => void }) {
  const { session } = usePlatformSession();
  const history = usePlatformResource<PlatformSettingVersionRecord[]>(`/api/v1/platform/settings?key=${encodeURIComponent(setting.key)}`, {
    isEmpty: (v) => v.length === 0,
  });
  const { reload } = history;
  const loadedNonce = useRef(nonce); // the first load already covers this one
  useEffect(() => {
    if (nonce === loadedNonce.current) return;
    loadedNonce.current = nonce;
    reload();
  }, [nonce, reload]);

  // One plain line rather than the illustrated empty state: most settings have never been changed
  if (history.state.kind === "empty") {
    return <p className={styles.small}>{setting.source === "STORED" ? "No changes recorded." : "Never changed. The code default has always applied."}</p>;
  }

  return (
    <ResourceView
      state={history.state}
      onRetry={reload}
      resource="setting history"
      emptyFigure="log-empty"
      emptyTitle="Never changed"
      emptyDescription="The code default has always applied."
      renderReady={(versions) => (
        <ul className={styles.history}>
          {versions
            .slice()
            .reverse()
            .map((v) => (
              <li key={v.id}>
                <span>
                  <span className={styles.num}>{showValue(v.value, setting.unit)}</span> · {formatDateTime(v.created_at)}
                  <small>
                    {v.changed_by_user_id === session.user.id ? "You" : v.changed_by_user_id}: {v.reason}
                  </small>
                </span>
                {canRestore && !sameValue(v.value, setting.value) && (
                  <Button size="sm" variant="ghost" onClick={() => onChange(v.value)} aria-label={`Restore ${showValue(v.value, setting.unit)}`}>
                    Restore
                  </Button>
                )}
              </li>
            ))}
        </ul>
      )}
    />
  );
}

/** Everything about the selected setting: the value in force, what a change needs, and its history. */
export const SettingInspector: React.FC<SettingInspectorProps> = ({
  setting,
  approval,
  canManage,
  historyNonce,
  onChange,
  onApprovalsChanged,
  onBack,
  focusOnOpen,
}) => {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnOpen) headingRef.current?.focus();
  }, [focusOnOpen, setting.key]);

  const numeric = typeof setting.value === "number";
  const inlineUnit = numeric && setting.unit === "%";
  const canChange = setting.editable && canManage && !approval;

  return (
    <div className={styles.inspector}>
      <button type="button" className={styles.back} onClick={onBack}>
        <ChevronLeft size={16} aria-hidden="true" />
        All settings
      </button>

      <div className={styles.summary}>
        <div className={styles.headline}>
          <h2 ref={headingRef} tabIndex={-1}>
            {setting.label}
          </h2>
          <div className={numeric || typeof setting.value === "boolean" || setting.value === "" ? styles.big : styles.bigText}>
            <span>{showValue(setting.value, inlineUnit ? "%" : undefined)}</span>
            {numeric && !inlineUnit && setting.unit && <small>{setting.unit}</small>}
          </div>
          <span className={styles.small}>{setting.source === "DEFAULT" ? "Code default" : `${isChanged(setting) ? "Changed" : "Same as the code default, set"} ${formatDateTime(setting.updated_at)}`}</span>
        </div>
        <p>{setting.description}</p>

        {approval && (
          <ApprovalBox key={approval.id} setting={setting} approval={approval} canManage={canManage} onChange={onChange} onApprovalsChanged={onApprovalsChanged} />
        )}
        {canChange && (
          <Button variant="outline" className={`${consoleStyles.inkButton} ${styles.action}`} onClick={() => onChange(setting.value)}>
            Change value
          </Button>
        )}
        {!setting.editable && <p className={styles.small}>No code reads this setting yet, so changing it would do nothing. It unlocks once a service uses it.</p>}
        {setting.editable && !canManage && (
          <p className={styles.small}>
            Your role can view settings but not change them. Missing permission: <code>platform_config.manage</code>
          </p>
        )}
      </div>

      {canChange && (
        <div className={styles.section}>
          <h3>To change this you need</h3>
          <ul className={styles.needs}>
            {requirements(setting).map((text) => (
              <li key={text}>
                <Circle size={12} aria-hidden="true" />
                {text}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.section}>
        <h3>Details</h3>
        <dl className={styles.details}>
          <dt>Key</dt>
          <dd className={consoleStyles.mono}>{setting.key}</dd>
          <dt>Read by</dt>
          <dd className={consoleStyles.mono}>{setting.read_by ?? "Nothing yet"}</dd>
          <dt>Default</dt>
          <dd className={styles.num}>{showValue(setting.default_value, setting.unit)}</dd>
          <dt>Risk</dt>
          <dd>{humanize(setting.risk)}</dd>
        </dl>
      </div>

      <div className={styles.section}>
        <h3>History</h3>
        {/* keyed, so one setting's history never shows under another while the next one loads */}
        <History key={setting.key} setting={setting} canRestore={canChange} nonce={historyNonce} onChange={onChange} />
      </div>
    </div>
  );
};
