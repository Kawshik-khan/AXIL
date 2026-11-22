"use client";

import React, { useState } from "react";
import Link from "next/link";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { PLATFORM_PERMISSIONS } from "@/lib/permissions";
import type { EffectiveSetting } from "@/domains/platform/services/platform-settings.service";
import type { PlatformInvoiceView } from "@/domains/platform/services/platform-billing.service";
import { usePlatformResource } from "../../_lib/use-platform-resource";
import { usePlatformSession } from "../../_lib/platform-session";
import { platformRequest } from "../../_lib/platform-client";
import { formatCount, formatDateTime, formatMoney } from "../../_lib/format";
import { CONSOLE_ROOT } from "../../_lib/platform-module-access";
import { ResourceView } from "../../_components/ResourceView";
import { StatusPill } from "../../_components/StatusPill";
import { PrivilegedActionDialog } from "../../_components/PrivilegedActionDialog";
import styles from "../../super-admin.module.css";

/** What GET /api/v1/platform/billing/payment-methods returns: names and modes only, never credentials. */
export interface PaymentReadiness {
  configured: boolean;
  gateways: string[];
  gateway_modes: Record<string, "LIVE" | "SANDBOX" | null>;
  manual: { bkash_number: string | null; nagad_number: string | null; bank_details: string | null };
}

const MANUAL = [
  { key: "billing.manual_bkash_number", field: "bkash_number", name: "bKash", env: "PLATFORM_BILLING_BKASH_NUMBER", kind: "phone" },
  { key: "billing.manual_nagad_number", field: "nagad_number", name: "Nagad", env: "PLATFORM_BILLING_NAGAD_NUMBER", kind: "phone" },
  { key: "billing.manual_bank_details", field: "bank_details", name: "Bank transfer", env: "PLATFORM_BILLING_BANK_DETAILS", kind: "text" },
] as const;

const GATEWAYS = [
  { id: "SSLCOMMERZ", name: "SSLCommerz", hint: "Cards, mobile banking, net banking", env: "PLATFORM_SSLCOMMERZ_STORE_ID, PLATFORM_SSLCOMMERZ_STORE_PASSWORD, PLATFORM_SSLCOMMERZ_MODE" },
  { id: "BKASH", name: "bKash checkout", hint: "Tokenized bKash payment", env: "PLATFORM_BKASH_APP_KEY, _APP_SECRET, _USERNAME, _PASSWORD, PLATFORM_BKASH_MODE" },
] as const;

const ACCESS_KEYS = ["billing.require_paid_subscription", "billing.trial_when_unpayable", "billing.support_contact"] as const;
const PAGE_KEYS: readonly string[] = [...MANUAL.map((m) => m.key), ...ACCESS_KEYS];
const PHONE = /^01[3-9]\d{8}$/;

function show(value: unknown): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  const text = String(value ?? "").trim();
  return text === "" ? "Not set" : text;
}

/** A clear yes/no on whether a new workspace can pay, from the readiness the server computed. */
function verdict(r: PaymentReadiness, paywall: boolean, safetyNet: boolean): { title: string; text: string; tone: "ok" | "warn" | "bad"; label: string } {
  const live = Object.values(r.gateway_modes).some((m) => m === "LIVE");
  if (!r.configured && paywall && !safetyNet) {
    return { title: "No. New shops are locked out.", text: "Sign-up asks for payment but there is no way to pay. Add a send-money account or connect a gateway.", tone: "bad", label: "Blocking sign-ups" };
  }
  if (!r.configured) {
    return {
      title: paywall ? "Not yet. New shops are offered a trial." : "Not needed: the paywall is off.",
      text: "Nobody is locked out, but nobody can pay either. Add a way to pay before trials end.",
      tone: "warn",
      label: paywall ? "Trial safety net" : "Paywall off",
    };
  }
  if (!live) {
    return { title: "Yes, by sending money.", text: "Each payment waits for an operator to confirm the transaction ID. A live gateway starts plans instantly.", tone: "warn", label: "Manual confirmation" };
  }
  return { title: "Yes. Plans start the moment they pay.", text: "Online checkout confirms automatically; send-money accounts stay as a backup.", tone: "ok", label: "Ready" };
}

/**
 * Plans & Billing → Payment methods: how workspaces pay their subscription. The send-money accounts and the sign-up
 * access settings are ordinary platform settings (settings-registry.ts), changed through the same governed dialog as
 * the Settings page; the gateway accounts live in the server environment and are only reported here, never shown.
 */
export function PaymentMethods({ readiness, onChanged }: { readiness: ReturnType<typeof usePlatformResource<PaymentReadiness>>; onChanged: () => void }) {
  const { can } = usePlatformSession();
  const canEdit = can(PLATFORM_PERMISSIONS.PLATFORM_CONFIG_MANAGE);
  const settings = usePlatformResource<EffectiveSetting[]>(can(PLATFORM_PERMISSIONS.PLATFORM_CONFIG_READ) ? "/api/v1/platform/settings" : null);
  const waiting = usePlatformResource<{ invoices: PlatformInvoiceView[] }>("/api/v1/platform/billing/invoices?status=ISSUED", {
    isEmpty: (d) => d.invoices.length === 0,
  });
  const [editing, setEditing] = useState<{ setting: EffectiveSetting; value: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const byKey = new Map((settings.state.kind === "ready" ? settings.state.data : []).filter((s) => PAGE_KEYS.includes(s.key)).map((s) => [s.key, s]));
  const setting = (key: string) => byKey.get(key);
  const paywall = setting("billing.require_paid_subscription")?.value !== false;
  const safetyNet = setting("billing.trial_when_unpayable")?.value === true;

  const edit = (key: string, value?: string) => {
    const s = setting(key);
    if (!s) return;
    setEditing({ setting: s, value: value ?? (typeof s.value === "boolean" ? String(!s.value) : String(s.value ?? "")) });
  };

  const parsed = editing ? (typeof editing.setting.default_value === "boolean" ? editing.value === "true" : editing.value.trim()) : null;
  const inputError =
    editing && typeof parsed === "string" && parsed !== ""
      ? editing.setting.key === "billing.manual_bank_details"
        ? parsed.length > 300
          ? "Keep it under 300 characters."
          : null
        : editing.setting.key === "billing.support_contact"
          ? PHONE.test(parsed) || /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(parsed)
            ? null
            : "Enter an 11-digit mobile number (01XXXXXXXXX) or an email address."
          : PHONE.test(parsed)
            ? null
            : "Enter an 11-digit Bangladeshi mobile number (01XXXXXXXXX)."
      : null;
  const changed = editing ? JSON.stringify(parsed) !== JSON.stringify(editing.setting.value) : false;

  return (
    <ResourceView
      state={readiness.state}
      onRetry={readiness.reload}
      resource="payment methods"
      emptyFigure="no-data"
      emptyTitle="No data"
      emptyDescription="The payment method status could not be read."
      renderReady={(r) => {
        const v = verdict(r, paywall, safetyNet);
        const manualCount = Object.values(r.manual).filter(Boolean).length;
        const live = Object.values(r.gateway_modes).filter((m) => m === "LIVE").length;
        const waitingCount = waiting.state.kind === "ready" ? waiting.state.data.invoices.length : waiting.state.kind === "empty" ? 0 : null;
        const checks: Array<{ on: boolean; title: string; detail: string }> = [
          { on: manualCount > 0, title: "A send-money account", detail: manualCount ? `${manualCount} of 3 set: workspaces can pay by sending money` : "bKash, Nagad or bank details for manual payments" },
          { on: r.gateways.length > 0, title: "An online gateway", detail: r.gateways.length ? `${r.gateways.length} connected` : "SSLCommerz or bKash: plans start without an operator" },
          { on: live > 0, title: "A live gateway", detail: live ? "Real payments confirm automatically" : "Sandbox payments never buy a real plan" },
          {
            on: r.configured || !paywall || safetyNet,
            title: "No one is locked out",
            detail: r.configured ? "Every new shop has a way to pay" : !paywall ? "The paywall is off" : safetyNet ? "New shops are offered the free trial" : "Turn on the trial safety net or add a way to pay",
          },
        ];

        return (
          <div className={styles.sectionGap}>
            {notice && (
              <div className={`${styles.banner} ${styles.bannerInfo}`} role="status">
                <span>{notice}</span>
                <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>
                  Dismiss
                </Button>
              </div>
            )}
            <BentoGrid>
              <BentoCard span={12} className={styles.darkCard}>
                <div className={styles.readiness}>
                  <div className={styles.rowMain}>
                    <span className={styles.kpiLabel}>Can a new workspace pay for a plan?</span>
                    <span className={styles.readinessTitle}>{v.title}</span>
                    <p>{v.text}</p>
                    <div className={styles.inlineActions}>
                      <StatusPill status={v.label} tone={v.tone} label={v.label} />
                      {waitingCount !== null && <p>{formatCount(waitingCount)} unpaid sign-up invoices</p>}
                    </div>
                  </div>
                  <ul className={styles.readinessChecks}>
                    {checks.map((c) => (
                      <li key={c.title}>
                        <span className={c.on ? styles.checkOn : styles.checkOff} aria-hidden="true">
                          {c.on ? "✓" : ""}
                        </span>
                        <span className={styles.rowMain}>
                          <span>
                            {c.title}
                            <span className={styles.visuallyHidden}>{c.on ? ": done" : ": not done"}</span>
                          </span>
                          <p>{c.detail}</p>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </BentoCard>

              <BentoCard
                span={7}
                title="Send-money accounts"
                subtitle="Workspaces send the invoice amount here and submit the transaction ID. An operator confirms it under Invoices."
                action={<StatusPill status="CRITICAL" tone="bad" label="Critical · second operator" />}
              >
                <ul className={styles.list}>
                  {MANUAL.map((m) => {
                    const s = setting(m.key);
                    const effective = r.manual[m.field];
                    const fromEnv = Boolean(effective) && !String(s?.value ?? "").trim();
                    return (
                      <li key={m.key} className={styles.listRow}>
                        <span className={styles.rowMain}>
                          <span className={styles.rowTitle}>{m.name}</span>
                          <span className={styles.rowMeta}>
                            {effective ? <span className={m.kind === "text" ? undefined : styles.mono}>{effective}</span> : "Not set"}
                            {fromEnv && ` · from ${m.env} in the server environment`}
                          </span>
                        </span>
                        <span className={styles.inlineActions}>
                          <StatusPill status={effective ? "ENABLED" : "DISABLED"} label={effective ? "Shown to workspaces" : "Off"} />
                          {canEdit && s && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => edit(m.key, String(s.value ?? ""))}>
                                {String(s.value ?? "").trim() ? "Change" : "Add"}
                              </Button>
                              {String(s.value ?? "").trim() !== "" && (
                                <Button size="sm" variant="ghost" onClick={() => edit(m.key, "")}>
                                  Remove
                                </Button>
                              )}
                            </>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <span className={styles.hint}>
                  Changing where money goes needs a reason and a second operator&apos;s approval of the exact value. Every change is in the{" "}
                  <Link href={`${CONSOLE_ROOT}/audit`}>audit log</Link>.
                  {!canEdit && " You can view these; changing them needs platform_config.manage."}
                </span>
              </BentoCard>

              <BentoCard span={5} title="Online checkout" subtitle="CommerceOS's own merchant accounts. Credentials stay in the server environment and are never shown here.">
                <ul className={styles.list}>
                  {GATEWAYS.map((g) => {
                    const mode = r.gateway_modes[g.id] ?? null;
                    return (
                      <li key={g.id} className={styles.listRow}>
                        <span className={styles.rowMain}>
                          <span className={styles.rowTitle}>{g.name}</span>
                          <span className={styles.rowMeta}>{mode ? g.hint : "Set in the server environment"}</span>
                        </span>
                        {mode === "LIVE" ? (
                          <StatusPill status="ACTIVE" label="Live" />
                        ) : mode === "SANDBOX" ? (
                          <StatusPill status="PENDING" label="Sandbox" />
                        ) : (
                          <StatusPill status="DISABLED" label="Not connected" />
                        )}
                      </li>
                    );
                  })}
                </ul>
                <details>
                  <summary className={styles.hint}>How to connect a gateway</summary>
                  <div className={styles.sectionGap}>
                    <span className={styles.hint}>Set these on the server (Render → Environment), then redeploy. Keep the mode on sandbox until the merchant account is approved.</span>
                    {GATEWAYS.map((g) => (
                      <code key={g.id} className={styles.mono}>
                        {g.env}
                      </code>
                    ))}
                  </div>
                </details>
              </BentoCard>

              <BentoCard span={12} title="Sign-up access" subtitle="What a new workspace from the public sign-up gets before it has paid">
                <ul className={styles.list}>
                  {ACCESS_KEYS.map((key) => {
                    const s = setting(key);
                    if (!s) return null;
                    return (
                      <li key={key} className={styles.listRow}>
                        <span className={styles.rowMain}>
                          <span className={styles.rowTitle}>{s.label}</span>
                          <span className={styles.rowMeta}>{s.description}</span>
                        </span>
                        <span className={styles.inlineActions}>
                          <span>{show(s.value)}</span>
                          {canEdit && (
                            <Button size="sm" variant="outline" onClick={() => edit(key)}>
                              {typeof s.value === "boolean" ? (s.value ? "Turn off" : "Turn on") : "Change"}
                            </Button>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {settings.state.kind === "error" && <span className={styles.fieldError}>The settings could not be loaded: {settings.state.message}</span>}
              </BentoCard>

              <BentoCard span={12} title="Workspaces waiting to pay" subtitle="Unpaid invoices. Contact these shops once a way to pay is set up.">
                <ResourceView
                  state={waiting.state}
                  onRetry={waiting.reload}
                  resource="unpaid invoices"
                  emptyFigure="empty-list"
                  emptyTitle="No unpaid invoices"
                  emptyDescription="Every invoice is paid, being checked or replaced."
                  renderReady={(d) => (
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Workspace</th>
                            <th>Plan</th>
                            <th>Invoice</th>
                            <th className={styles.numeric}>Amount</th>
                            <th>Issued</th>
                            <th>Due</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.invoices.slice(0, 50).map((i) => (
                            <tr key={i.id}>
                              <td>
                                <Link href={`${CONSOLE_ROOT}/tenants/${encodeURIComponent(i.tenant_id)}?tab=commercial`}>{i.tenant_name ?? i.tenant_id}</Link>
                              </td>
                              <td>{i.plan_name ?? i.plan_id}</td>
                              <td className={styles.mono}>{i.invoice_number}</td>
                              <td className={styles.numeric}>{formatMoney(i.amount_bdt, "BDT")}</td>
                              <td>{formatDateTime(i.created_at)}</td>
                              <td>{formatDateTime(i.due_date)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                />
              </BentoCard>
            </BentoGrid>

            {editing && (
              <PrivilegedActionDialog
                open
                onClose={() => setEditing(null)}
                actionKey={editing.setting.risk === "HIGH" || editing.setting.risk === "CRITICAL" ? "platform_config.update_governed" : "platform_config.update"}
                target={{ type: "platform", id: editing.setting.key, label: editing.setting.label }}
                canSubmit={changed && !inputError}
                execute={async (a) =>
                  (
                    await platformRequest(
                      "/api/v1/platform/settings",
                      {
                        method: "POST",
                        json: {
                          key: editing.setting.key,
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
                onDone={() => {
                  setNotice(`${editing.setting.label} updated. New workspaces see it on their next page load.`);
                  settings.reload();
                  onChanged();
                }}
              >
                <span className={styles.hint}>
                  {editing.setting.description} Now: {show(editing.setting.value)}.
                </span>
                {typeof editing.setting.default_value === "boolean" ? (
                  <label className={styles.field}>
                    New value
                    <select className={styles.select} value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })}>
                      <option value="true">On</option>
                      <option value="false">Off</option>
                    </select>
                  </label>
                ) : editing.setting.key === "billing.manual_bank_details" ? (
                  <label className={styles.field}>
                    Bank, account name, account number and branch (empty removes it)
                    <textarea className={styles.input} rows={3} maxLength={300} value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} />
                  </label>
                ) : (
                  <label className={styles.field}>
                    New value (empty removes it)
                    <input
                      className={styles.input}
                      value={editing.value}
                      autoComplete="off"
                      placeholder={editing.setting.key === "billing.support_contact" ? "01XXXXXXXXX or support@example.com" : "01XXXXXXXXX"}
                      onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                    />
                  </label>
                )}
                {inputError && <span className={styles.fieldError}>{inputError}</span>}
                {typeof parsed === "string" && changed && !inputError && (
                  <dl className={styles.definition}>
                    <dt>Now</dt>
                    <dd>{show(editing.setting.value)}</dd>
                    <dt>After</dt>
                    <dd>{show(parsed)}</dd>
                  </dl>
                )}
              </PrivilegedActionDialog>
            )}
          </div>
        );
      }}
    />
  );
}
