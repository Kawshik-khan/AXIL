"use client";

import React, { useState } from "react";
import { ArrowRight } from "lucide-react";
import type { EffectiveSetting } from "@/domains/platform/services/platform-settings.service";
import { platformRequest } from "../../_lib/platform-client";
import { PrivilegedActionDialog } from "../../_components/PrivilegedActionDialog";
import { isGoverned, isLongText, parseInput, rangeText, sameValue, showValue, toInput, valueError } from "./setting-view";
import consoleStyles from "../../super-admin.module.css";
import styles from "./settings.module.css";

/** The privileged action the server runs this setting's change through. */
export function actionKeyFor(setting: EffectiveSetting): string {
  return isGoverned(setting) ? "platform_config.update_governed" : "platform_config.update";
}

export interface ChangeSettingDialogProps {
  setting: EffectiveSetting;
  /** The value the form starts with: the one in force, an earlier version, or an approved one. */
  initialValue: unknown;
  onClose: () => void;
  onDone: () => void;
}

/** One setting's change: the value in force beside the new one, then the shared privileged-action flow. */
export const ChangeSettingDialog: React.FC<ChangeSettingDialogProps> = ({ setting, initialValue, onClose, onDone }) => {
  const [text, setText] = useState(() => toInput(initialValue));
  const isBoolean = typeof setting.default_value === "boolean";
  const parsed = parseInput(text, setting.default_value);
  const error = valueError(setting.key, parsed);
  const changed = !sameValue(parsed, setting.value);
  const range = rangeText(setting.key);
  const longText = isLongText(setting.key);
  const hint = `${range ? `${range} ` : ""}Code default: ${showValue(setting.default_value, setting.unit)}.${changed ? "" : " This is the value in force now."}`;

  return (
    <PrivilegedActionDialog
      open
      onClose={onClose}
      title={setting.label}
      actionKey={actionKeyFor(setting)}
      target={{ type: "platform", id: setting.key, label: setting.label }}
      canSubmit={!error && changed}
      submitLabel="Continue"
      guided={{ summary: `${showValue(setting.value, setting.unit)} to ${error ? text : showValue(parsed, setting.unit)}` }}
      execute={async (a) =>
        (
          await platformRequest(
            "/api/v1/platform/settings",
            {
              method: "POST",
              json: {
                key: setting.key,
                value: parsed,
                reason: a.reason,
                ...(a.ticketRef ? { ticket_ref: a.ticketRef } : {}),
                ...(a.approvalId ? { approval_id: a.approvalId } : {}),
              },
            },
            a.stepUpToken
          )
        ).data
      }
      onDone={onDone}
    >
      <div className={styles.change}>
        <div className={`${styles.diff} ${longText ? styles.diffStacked : ""}`}>
          <div className={consoleStyles.field}>
            In force
            <span className={styles.was}>{showValue(setting.value, setting.unit)}</span>
          </div>
          <ArrowRight className={styles.arrow} size={16} aria-hidden="true" />
          {isBoolean ? (
            <div className={consoleStyles.field}>
              New value
              <div className={`${styles.segment} ${styles.segmentFull}`} role="group" aria-label="New value">
                <button type="button" aria-pressed={text === "true"} onClick={() => setText("true")}>
                  On
                </button>
                <button type="button" aria-pressed={text === "false"} onClick={() => setText("false")}>
                  Off
                </button>
              </div>
            </div>
          ) : (
            <label className={consoleStyles.field}>
              New value{setting.unit ? ` (${setting.unit})` : ""}
              {longText ? (
                <textarea
                  className={consoleStyles.textarea}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  aria-invalid={Boolean(error)}
                  aria-describedby="setting-value-hint"
                />
              ) : (
                <input
                  className={`${consoleStyles.input} ${styles.newValue}`}
                  inputMode={typeof setting.default_value === "number" ? "decimal" : undefined}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  aria-invalid={Boolean(error)}
                  aria-describedby="setting-value-hint"
                />
              )}
            </label>
          )}
        </div>
        <span id="setting-value-hint" className={error ? styles.hintError : consoleStyles.hint} role={error ? "alert" : undefined}>
          {error ?? hint}
        </span>
      </div>
    </PrivilegedActionDialog>
  );
};
