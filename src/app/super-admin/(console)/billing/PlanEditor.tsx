"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button/Button";
import { ENTITLEMENT_CATALOG, entitlementValueError, type EntitlementValue } from "@/domains/platform/entitlement-catalog";
import type { PlanView, PlanVersionView } from "@/domains/platform/services/platform-plan.service";
import { PlatformApiError, platformRequest } from "../../_lib/platform-client";
import { formatMoney, humanize } from "../../_lib/format";
import { StatusPill } from "../../_components/StatusPill";
import styles from "../../super-admin.module.css";

type FeatureDraft = Record<string, { mode: "unset" | "value" | "unlimited"; value: string }>;

function draftFrom(version: PlanVersionView | null): FeatureDraft {
  const draft: FeatureDraft = {};
  for (const spec of ENTITLEMENT_CATALOG) {
    const v = version?.features?.[spec.id];
    if (v === undefined) draft[spec.id] = { mode: "unset", value: "" };
    else if (v === null) draft[spec.id] = { mode: "unlimited", value: "" };
    else draft[spec.id] = { mode: "value", value: String(v) };
  }
  return draft;
}

function priceText(v: number | null | undefined): string {
  return v === null || v === undefined ? "" : String(v);
}

function toNumberOrNull(text: string): number | null {
  const t = text.trim();
  return t === "" ? null : Number(t);
}

/**
 * The plan version editor (plan C2): prices, trial, setup fee and the entitlement matrix generated from the catalog.
 * Only enforced entitlements are editable; the right column diffs the draft against the published version.
 */
export const PlanEditor: React.FC<{ plan: PlanView; canEdit: boolean; onSaved: () => void }> = ({ plan, canEdit, onSaved }) => {
  const base = plan.draft_version ?? plan.current_version;
  const [monthly, setMonthly] = useState(priceText(base?.monthly_price));
  const [annual, setAnnual] = useState(priceText(base?.annual_price));
  const [trial, setTrial] = useState(priceText(base?.trial_days));
  const [setupFee, setSetupFee] = useState(priceText(base?.setup_fee_bdt));
  const [note, setNote] = useState(plan.draft_version?.change_note ?? "");
  const [features, setFeatures] = useState<FeatureDraft>(() => draftFrom(base ?? null));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const src = plan.draft_version ?? plan.current_version;
    setMonthly(priceText(src?.monthly_price));
    setAnnual(priceText(src?.annual_price));
    setTrial(priceText(src?.trial_days));
    setSetupFee(priceText(src?.setup_fee_bdt));
    setNote(plan.draft_version?.change_note ?? "");
    setFeatures(draftFrom(src ?? null));
    setMessage(null);
  }, [plan]);

  const featureMap = useMemo(() => {
    const out: Record<string, EntitlementValue> = {};
    for (const spec of ENTITLEMENT_CATALOG) {
      const f = features[spec.id];
      if (!f || f.mode === "unset") continue;
      if (f.mode === "unlimited") out[spec.id] = null;
      else if (spec.kind === "FEATURE") out[spec.id] = f.value === "true";
      else out[spec.id] = f.value.trim() === "" ? NaN : Number(f.value);
    }
    return out;
  }, [features]);

  const problems = useMemo(() => {
    const list = Object.entries(featureMap)
      .map(([id, v]) => entitlementValueError(id, v))
      .filter((p): p is string => p !== null);
    for (const [label, text] of [["Monthly price", monthly], ["Annual price", annual], ["Setup fee", setupFee], ["Trial days", trial]] as const) {
      if (text.trim() !== "" && !/^\d+$/.test(text.trim())) list.push(`${label} must be a whole number.`);
    }
    return list;
  }, [featureMap, monthly, annual, setupFee, trial]);

  const published = plan.current_version;
  const changed = (id: string): boolean => {
    const before = published?.features?.[id];
    const after = Object.hasOwn(featureMap, id) ? featureMap[id] : undefined;
    return JSON.stringify(before ?? "unset") !== JSON.stringify(after ?? "unset");
  };

  const saveDraft = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await platformRequest(`/api/v1/platform/plans/${encodeURIComponent(plan.id)}/versions`, {
        method: "POST",
        json: {
          monthly_price_bdt: toNumberOrNull(monthly),
          annual_price_bdt: toNumberOrNull(annual),
          trial_days: toNumberOrNull(trial),
          setup_fee_bdt: toNumberOrNull(setupFee),
          features: featureMap,
          ...(note.trim() ? { change_note: note.trim() } : {}),
        },
      });
      setMessage({ ok: true, text: "Draft saved. Publish it to offer it to new subscribers." });
      onSaved();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof PlatformApiError ? `${err.message}${err.requestId ? ` (request ${err.requestId})` : ""}` : "Saving failed." });
    } finally {
      setBusy(false);
    }
  };

  const editable = canEdit;
  const setFeature = (id: string, patch: Partial<FeatureDraft[string]>) => setFeatures((f) => ({ ...f, [id]: { ...f[id], ...patch } }));

  return (
    <div className={styles.sectionGap}>
      <div className={styles.inlineActions}>
        {plan.draft_version ? (
          <StatusPill status="DRAFT" label={`Editing draft v${plan.draft_version.version}`} />
        ) : (
          <StatusPill status="PUBLISHED" tone="neutral" label={published ? `Starting a new draft from v${published.version}` : "First draft"} />
        )}
        <span className={styles.hint}>Published versions never change; subscribers keep theirs until moved.</span>
      </div>

      <div className={styles.definition}>
        <label className={styles.field}>
          Monthly price (৳)
          <input className={styles.input} inputMode="numeric" value={monthly} disabled={!editable} onChange={(e) => setMonthly(e.target.value)} placeholder="Not sold monthly" />
        </label>
        <label className={styles.field}>
          Annual price (৳)
          <input className={styles.input} inputMode="numeric" value={annual} disabled={!editable} onChange={(e) => setAnnual(e.target.value)} placeholder="Not sold annually" />
        </label>
        <label className={styles.field}>
          Trial days
          <input className={styles.input} inputMode="numeric" value={trial} disabled={!editable} onChange={(e) => setTrial(e.target.value)} placeholder="Default trial setting" />
        </label>
        <label className={styles.field}>
          Setup fee (৳)
          <input className={styles.input} inputMode="numeric" value={setupFee} disabled={!editable} onChange={(e) => setSetupFee(e.target.value)} placeholder="None" />
        </label>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Limit or feature</th>
              <th>On this plan</th>
              <th>Published v{published?.version ?? "—"}</th>
            </tr>
          </thead>
          <tbody>
            {ENTITLEMENT_CATALOG.map((spec) => {
              const f = features[spec.id] ?? { mode: "unset", value: "" };
              const enforced = spec.enforcedBy !== null;
              const before = published?.features?.[spec.id];
              return (
                <tr key={spec.id}>
                  <td>
                    <span className={styles.rowMain}>
                      <span className={styles.rowTitle}>{spec.label}</span>
                      <span className={styles.rowMeta}>{enforced ? `${humanize(spec.kind)}${spec.unit ? ` · ${spec.unit}` : ""}` : "Not enforced yet — can't be set"}</span>
                    </span>
                  </td>
                  <td>
                    {enforced ? (
                      <div className={styles.inlineActions}>
                        <select
                          className={styles.select}
                          value={f.mode}
                          disabled={!editable}
                          onChange={(e) => setFeature(spec.id, { mode: e.target.value as FeatureDraft[string]["mode"] })}
                          aria-label={`${spec.label} setting`}
                        >
                          <option value="unset">Use global default</option>
                          <option value="value">{spec.kind === "FEATURE" ? "Set on/off" : "Set a limit"}</option>
                          {spec.allowUnlimited && <option value="unlimited">Unlimited</option>}
                        </select>
                        {f.mode === "value" &&
                          (spec.kind === "FEATURE" ? (
                            <select className={styles.select} value={f.value} disabled={!editable} onChange={(e) => setFeature(spec.id, { value: e.target.value })}>
                              <option value="">Choose</option>
                              <option value="true">On</option>
                              <option value="false">Off</option>
                            </select>
                          ) : (
                            <input
                              className={styles.input}
                              inputMode="numeric"
                              value={f.value}
                              disabled={!editable}
                              onChange={(e) => setFeature(spec.id, { value: e.target.value.replace(/\D/g, "") })}
                              aria-label={`${spec.label} limit`}
                            />
                          ))}
                        {changed(spec.id) && <StatusPill status="DRAFT" tone="info" label="Changed" />}
                      </div>
                    ) : (
                      <span className={styles.muted}>—</span>
                    )}
                  </td>
                  <td className={styles.mono}>{before === undefined ? "default" : before === null ? "unlimited" : String(before)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {published && (
        <span className={styles.hint}>
          Published v{published.version}: {published.monthly_price !== null ? `${formatMoney(published.monthly_price, "BDT")}/month` : "no monthly price"}
          {published.annual_price !== null ? ` · ${formatMoney(published.annual_price, "BDT")}/year` : ""}
          {published.unknown_feature_keys.length > 0 ? ` · ignored keys: ${published.unknown_feature_keys.join(", ")}` : ""}
        </span>
      )}

      <label className={styles.field}>
        Change note
        <input className={styles.input} value={note} disabled={!editable} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="What changes in this version and why" />
      </label>

      {problems.length > 0 && (
        <ul className={styles.list}>
          {problems.map((p) => (
            <li key={p} className={styles.fieldError}>
              {p}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className={styles.inlineActions}>
          <Button size="sm" onClick={saveDraft} isLoading={busy} disabled={problems.length > 0}>
            Save draft
          </Button>
        </div>
      )}
      {message && <span className={message.ok ? styles.hint : styles.fieldError}>{message.text}</span>}
    </div>
  );
};
