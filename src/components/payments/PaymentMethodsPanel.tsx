"use client";

import React, { useCallback, useEffect, useState } from "react";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { Input } from "@/components/ui/Input/Input";
import { Switch } from "@/components/ui/Switch/Switch";
import { ErrorState, LoadingSkeleton, PermissionDenied } from "@/components/ui/States/States";
import { api, formatDateTime, GATEWAY_NAMES, type ApiFailure } from "./api";
import styles from "./Payments.module.css";

type Provider = "SSLCOMMERZ" | "BKASH";
type AccountType = "PERSONAL" | "MERCHANT";

interface GatewayView {
  configured: boolean;
  enabled: boolean;
  mode: "SANDBOX" | "LIVE" | null;
  account_hint: string | null;
  updated_at: string | null;
}

interface SettingsView {
  manual: {
    bkash_number?: string;
    bkash_account_type?: AccountType;
    nagad_number?: string;
    nagad_account_type?: AccountType;
    rocket_number?: string;
    instructions?: string;
  };
  gateways: Record<Provider, GatewayView>;
  sandbox_settles: boolean;
  updated_at: string | null;
}

const CREDENTIAL_FIELDS: Record<Provider, Array<{ key: string; label: string; secret: boolean }>> = {
  SSLCOMMERZ: [
    { key: "store_id", label: "Store ID", secret: false },
    { key: "store_password", label: "Store password", secret: true },
  ],
  BKASH: [
    { key: "username", label: "Username", secret: false },
    { key: "password", label: "Password", secret: true },
    { key: "app_key", label: "App key", secret: true },
    { key: "app_secret", label: "App secret", secret: true },
  ],
};

const GATEWAY_ABOUT: Record<Provider, string> = {
  SSLCOMMERZ: "One checkout page for bKash, Nagad, Rocket, cards and internet banking. Uses your own SSLCommerz merchant account.",
  BKASH: "bKash checkout with the customer's own bKash number and PIN. Uses your own bKash merchant (PGW) account.",
};

interface GatewayDraft {
  enabled: boolean;
  mode: "SANDBOX" | "LIVE";
  credentials: Record<string, string>;
}

const emptyDraft = (view?: GatewayView): GatewayDraft => ({ enabled: view?.enabled ?? false, mode: view?.mode ?? "SANDBOX", credentials: {} });

/**
 * How this shop gets paid by its customers: the wallet numbers shown on payment links, and the shop's own gateway
 * accounts. Saved credentials are never sent back to the browser; leaving the fields empty keeps them.
 */
export function PaymentMethodsPanel({ canEdit }: { canEdit: boolean }) {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [loadError, setLoadError] = useState<(ApiFailure & { status: number }) | null>(null);
  const [manual, setManual] = useState<SettingsView["manual"]>({});
  const [drafts, setDrafts] = useState<Record<Provider, GatewayDraft>>({ SSLCOMMERZ: emptyDraft(), BKASH: emptyDraft() });
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const apply = (view: SettingsView) => {
    setSettings(view);
    setManual(view.manual);
    setDrafts({ SSLCOMMERZ: emptyDraft(view.gateways.SSLCOMMERZ), BKASH: emptyDraft(view.gateways.BKASH) });
  };

  const load = useCallback(async () => {
    const result = await api<{ settings: SettingsView }>("/api/v1/payments/settings");
    if (result.ok && result.data) {
      apply(result.data.settings);
      setLoadError(null);
    } else if (result.error) {
      setLoadError({ ...result.error, status: result.status });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (what: string, body: Record<string, unknown>, done: string) => {
    setMessage(null);
    setSaving(what);
    const result = await api<{ settings: SettingsView }>("/api/v1/payments/settings", { method: "PUT", json: body, stepUp: true });
    setSaving(null);
    if (result.ok && result.data) {
      apply(result.data.settings);
      setMessage({ tone: "success", text: done });
    } else {
      setMessage({ tone: "danger", text: result.error?.message ?? "Could not save." });
    }
  };

  const saveManual = (event: React.FormEvent) => {
    event.preventDefault();
    void save(
      "manual",
      {
        manual: {
          bkash_number: manual.bkash_number ?? "",
          bkash_account_type: manual.bkash_account_type ?? "PERSONAL",
          nagad_number: manual.nagad_number ?? "",
          nagad_account_type: manual.nagad_account_type ?? "PERSONAL",
          rocket_number: manual.rocket_number ?? "",
          instructions: manual.instructions ?? "",
        },
      },
      "Wallet numbers saved. They now show on your payment links."
    );
  };

  const saveGateway = (provider: Provider) => {
    const draft = drafts[provider];
    const fields = CREDENTIAL_FIELDS[provider];
    const filled = fields.filter((f) => (draft.credentials[f.key] ?? "").trim() !== "");
    if (filled.length > 0 && filled.length < fields.length) {
      setMessage({ tone: "danger", text: `Fill in every ${GATEWAY_NAMES[provider]} credential, or leave them all empty to keep the saved ones.` });
      return;
    }
    const credentials = filled.length === fields.length ? Object.fromEntries(fields.map((f) => [f.key, draft.credentials[f.key].trim()])) : undefined;
    void save(
      provider,
      { gateways: { [provider]: { enabled: draft.enabled, mode: draft.mode, ...(credentials ? { credentials } : {}) } } },
      `${GATEWAY_NAMES[provider]} ${draft.enabled ? "is on" : "saved (switched off)"}.`
    );
  };

  if (loadError) {
    return (
      <BentoCard span={12} title="Payment methods">
        {loadError.status === 403 ? (
          <PermissionDenied resource="payment methods" requiredPermission="settings.read" inline />
        ) : (
          <ErrorState message={loadError.message} requestId={loadError.request_id} onRetry={() => void load()} inline />
        )}
      </BentoCard>
    );
  }
  if (!settings) {
    return (
      <BentoCard span={12} title="Payment methods">
        <LoadingSkeleton lines={4} inline />
      </BentoCard>
    );
  }

  const setDraft = (provider: Provider, patch: Partial<GatewayDraft>) => setDrafts((all) => ({ ...all, [provider]: { ...all[provider], ...patch } }));

  return (
    <>
      {message && (
        <div className={message.tone === "success" ? styles.noticeSuccess : styles.noticeDanger} role={message.tone === "success" ? "status" : "alert"} style={{ gridColumn: "span 12" }}>
          {message.text}
        </div>
      )}

      <BentoCard span={12} title="Send-money numbers" subtitle="Shown on your payment links. Customers send the money and submit the transaction ID; you confirm it before the order counts as paid.">
        <form className={styles.stack} onSubmit={saveManual}>
          <div className={styles.formGrid}>
            <Input
              label="bKash number"
              placeholder="01XXXXXXXXX"
              inputMode="numeric"
              value={manual.bkash_number ?? ""}
              onChange={(e) => setManual((m) => ({ ...m, bkash_number: e.target.value.trim() }))}
              disabled={!canEdit}
            />
            <div>
              <label className={styles.fieldLabel} htmlFor="bkash-type">
                bKash account type
              </label>
              <select
                id="bkash-type"
                className={styles.select}
                value={manual.bkash_account_type ?? "PERSONAL"}
                onChange={(e) => setManual((m) => ({ ...m, bkash_account_type: e.target.value as AccountType }))}
                disabled={!canEdit}
              >
                <option value="PERSONAL">Personal (customer uses Send Money)</option>
                <option value="MERCHANT">Merchant (customer uses Payment)</option>
              </select>
            </div>
            <Input
              label="Nagad number"
              placeholder="01XXXXXXXXX"
              inputMode="numeric"
              value={manual.nagad_number ?? ""}
              onChange={(e) => setManual((m) => ({ ...m, nagad_number: e.target.value.trim() }))}
              disabled={!canEdit}
            />
            <div>
              <label className={styles.fieldLabel} htmlFor="nagad-type">
                Nagad account type
              </label>
              <select
                id="nagad-type"
                className={styles.select}
                value={manual.nagad_account_type ?? "PERSONAL"}
                onChange={(e) => setManual((m) => ({ ...m, nagad_account_type: e.target.value as AccountType }))}
                disabled={!canEdit}
              >
                <option value="PERSONAL">Personal (customer uses Send Money)</option>
                <option value="MERCHANT">Merchant (customer uses Payment)</option>
              </select>
            </div>
            <Input
              label="Rocket number"
              placeholder="01XXXXXXXXXX"
              inputMode="numeric"
              value={manual.rocket_number ?? ""}
              onChange={(e) => setManual((m) => ({ ...m, rocket_number: e.target.value.trim() }))}
              disabled={!canEdit}
            />
          </div>
          <div>
            <label className={styles.fieldLabel} htmlFor="pay-instructions">
              Note for customers (optional)
            </label>
            <textarea
              id="pay-instructions"
              className={styles.textarea}
              maxLength={500}
              placeholder="e.g. Use your order number as the reference."
              value={manual.instructions ?? ""}
              onChange={(e) => setManual((m) => ({ ...m, instructions: e.target.value }))}
              disabled={!canEdit}
            />
          </div>
          {canEdit && (
            <div className={styles.rowEnd}>
              <Button type="submit" isLoading={saving === "manual"} disabled={saving !== null}>
                Save numbers
              </Button>
            </div>
          )}
        </form>
      </BentoCard>

      {(Object.keys(CREDENTIAL_FIELDS) as Provider[]).map((provider) => {
        const view = settings.gateways[provider];
        const draft = drafts[provider];
        return (
          <BentoCard
            key={provider}
            span={6}
            title={`${GATEWAY_NAMES[provider]} checkout`}
            subtitle={GATEWAY_ABOUT[provider]}
            action={
              <span className={`${styles.pill} ${view.enabled ? styles.pillSuccess : ""}`}>
                {view.enabled ? (view.mode === "LIVE" ? "On · Live" : "On · Sandbox") : view.configured ? "Off" : "Not set up"}
              </span>
            }
          >
            <div className={styles.stack}>
              {view.configured && (
                <p className={styles.muted}>
                  Saved account: <span className={styles.mono}>{view.account_hint ?? "saved"}</span> · updated {formatDateTime(view.updated_at)}. Leave the
                  fields below empty to keep it.
                </p>
              )}
              <div className={styles.formGrid}>
                {CREDENTIAL_FIELDS[provider].map((field) => (
                  <Input
                    key={field.key}
                    label={field.label}
                    type={field.secret ? "password" : "text"}
                    autoComplete="off"
                    placeholder={view.configured ? "Saved" : ""}
                    value={draft.credentials[field.key] ?? ""}
                    onChange={(e) => setDraft(provider, { credentials: { ...draft.credentials, [field.key]: e.target.value } })}
                    disabled={!canEdit}
                  />
                ))}
              </div>
              <div className={styles.formGrid}>
                <div>
                  <label className={styles.fieldLabel} htmlFor={`${provider}-mode`}>
                    Mode
                  </label>
                  <select
                    id={`${provider}-mode`}
                    className={styles.select}
                    value={draft.mode}
                    onChange={(e) => setDraft(provider, { mode: e.target.value as "SANDBOX" | "LIVE" })}
                    disabled={!canEdit}
                  >
                    <option value="SANDBOX">Sandbox (test money)</option>
                    <option value="LIVE">Live (real money)</option>
                  </select>
                </div>
                <div className={styles.row}>
                  <Switch
                    checked={draft.enabled}
                    onChange={(enabled) => setDraft(provider, { enabled })}
                    label={`Offer ${GATEWAY_NAMES[provider]} on payment links`}
                    disabled={!canEdit}
                  />
                  <span className={styles.muted}>Offer on payment links</span>
                </div>
              </div>
              {draft.mode === "SANDBOX" && (
                <div className={styles.noticeWarning}>
                  {settings.sandbox_settles
                    ? "Sandbox uses test money, and this installation is set to apply sandbox payments (demo mode): an order is marked paid, tagged TEST, without real money. Switch to Live with your live credentials before sending links to real customers."
                    : "Sandbox uses test money. A sandbox payment is shown to the customer as a test and does not mark the order paid. Switch to Live with your live credentials before sending links to real customers."}
                </div>
              )}
              {canEdit && (
                <div className={styles.rowEnd}>
                  <Button onClick={() => saveGateway(provider)} isLoading={saving === provider} disabled={saving !== null}>
                    Save {GATEWAY_NAMES[provider]}
                  </Button>
                </div>
              )}
            </div>
          </BentoCard>
        );
      })}
    </>
  );
}
