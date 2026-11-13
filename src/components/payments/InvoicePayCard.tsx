"use client";

import React, { useState } from "react";
import { ChevronRight } from "lucide-react";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { Input } from "@/components/ui/Input/Input";
import { api, formatBdt, formatDate, GATEWAY_HINTS, GATEWAY_NAMES } from "./api";
import styles from "./Payments.module.css";

export interface BillingInvoice {
  id: string;
  invoice_number: string;
  plan_id: string;
  billing_period: "MONTHLY" | "ANNUAL";
  kind: "NEW" | "RENEWAL" | "PLAN_CHANGE";
  plan_price_bdt: number;
  setup_fee_bdt: number;
  amount_bdt: number;
  status: "ISSUED" | "PENDING_VERIFICATION" | "PAID" | "VOID";
  due_date: string;
  period_start?: string;
  period_end?: string;
  payment_method?: string;
  manual_transaction_id?: string;
  manual_rejection_reason?: string;
  paid_at?: string;
  test_mode?: boolean;
  created_at: string;
}

export interface BillingPaymentOptions {
  gateways: string[];
  manual: { bkash_number: string | null; nagad_number: string | null; bank_details: string | null };
}

type ManualMethod = "MANUAL_BKASH" | "MANUAL_NAGAD" | "MANUAL_BANK";

/**
 * The open invoice and the ways to pay it: online through the platform's gateway account, or by sending the money
 * and submitting the transaction id for a CommerceOS operator to check. The plan changes only after one of those is
 * confirmed, so nothing here claims success by itself.
 */
export function InvoicePayCard({
  invoice,
  planName,
  options,
  canPay,
  onChanged,
}: {
  invoice: BillingInvoice;
  planName: string;
  options: BillingPaymentOptions;
  canPay: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [phone, setPhone] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [method, setMethod] = useState<ManualMethod | "">("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const manualMethods: Array<{ method: ManualMethod; label: string; detail: string }> = [];
  if (options.manual.bkash_number) manualMethods.push({ method: "MANUAL_BKASH", label: "bKash", detail: options.manual.bkash_number });
  if (options.manual.nagad_number) manualMethods.push({ method: "MANUAL_NAGAD", label: "Nagad", detail: options.manual.nagad_number });
  if (options.manual.bank_details) manualMethods.push({ method: "MANUAL_BANK", label: "Bank transfer", detail: options.manual.bank_details });
  const chosen = method || manualMethods[0]?.method || "";
  const nothingConfigured = options.gateways.length === 0 && manualMethods.length === 0;

  const payOnline = async (provider: string) => {
    setError(null);
    if (!/^01[3-9]\d{8}$/.test(phone.trim())) {
      setError("Enter the payer's 11-digit mobile number (01XXXXXXXXX) first.");
      return;
    }
    setBusy(provider);
    const result = await api<{ redirect_url: string }>(`/api/v1/billing/invoices/${encodeURIComponent(invoice.id)}/checkout`, {
      method: "POST",
      json: { provider, phone: phone.trim() },
    });
    if (result.ok && result.data?.redirect_url) {
      window.location.href = result.data.redirect_url; // the gateway's own page
      return;
    }
    setBusy(null);
    setError(result.error?.message ?? "Could not start the payment.");
  };

  const submitManual = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!chosen) return;
    setError(null);
    setBusy("manual");
    const result = await api(`/api/v1/billing/invoices/${encodeURIComponent(invoice.id)}/manual-payment`, {
      method: "POST",
      json: { method: chosen, transaction_id: transactionId.trim() },
    });
    setBusy(null);
    if (!result.ok) setError(result.error?.message ?? "Could not submit the transaction ID.");
    else setTransactionId("");
    await onChanged();
  };

  return (
    <BentoCard
      span={12}
      title={`Invoice ${invoice.invoice_number}`}
      subtitle={`${planName} · ${invoice.billing_period === "ANNUAL" ? "1 year" : "1 month"}${invoice.setup_fee_bdt > 0 ? ` · includes ${formatBdt(invoice.setup_fee_bdt)} one-time setup fee` : ""} · due ${formatDate(invoice.due_date)}`}
      action={<span className={styles.price}>{formatBdt(invoice.amount_bdt)}</span>}
    >
      <div className={styles.stack}>
        {invoice.status === "PENDING_VERIFICATION" ? (
          <div className={styles.notice} role="status">
            <strong>We are checking your payment.</strong> You submitted transaction ID <span className={styles.mono}>{invoice.manual_transaction_id}</span>. Your
            plan starts as soon as a CommerceOS operator confirms it; nothing else is needed from you.
          </div>
        ) : (
          <>
            {invoice.manual_rejection_reason && (
              <div className={styles.noticeDanger} role="alert">
                Your last payment could not be confirmed: {invoice.manual_rejection_reason} Check the transaction ID and submit it again.
              </div>
            )}
            {error && (
              <div className={styles.noticeDanger} role="alert">
                {error}
              </div>
            )}
            {!canPay ? (
              <p className={styles.muted}>Only an owner or admin can pay this invoice (needs settings.update).</p>
            ) : nothingConfigured ? (
              <div className={styles.noticeWarning} role="status">
                No payment method is set up on this CommerceOS installation yet, so this invoice can't be paid from here. Contact CommerceOS support.
              </div>
            ) : (
              <div className={styles.grid}>
                {options.gateways.length > 0 && (
                  <section className={styles.stack} style={{ gridColumn: "span 6" }} aria-label="Pay online">
                    <h3 className={styles.sectionTitle}>Pay online</h3>
                    <Input
                      label="Payer's mobile number"
                      placeholder="01XXXXXXXXX"
                      inputMode="numeric"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      hint="The gateway asks for it; bKash pre-fills it."
                    />
                    {options.gateways.map((provider) => (
                      <button key={provider} type="button" className={styles.methodButton} disabled={busy !== null} onClick={() => void payOnline(provider)}>
                        <span>
                          {busy === provider ? "Opening" : "Pay with"} {GATEWAY_NAMES[provider] ?? provider}
                          <br />
                          <span className={styles.methodHint}>{GATEWAY_HINTS[provider] ?? ""}</span>
                        </span>
                        <ChevronRight size={18} aria-hidden />
                      </button>
                    ))}
                  </section>
                )}
                {manualMethods.length > 0 && (
                  <section className={styles.stack} style={{ gridColumn: "span 6" }} aria-label="Send the money and submit the transaction ID">
                    <h3 className={styles.sectionTitle}>Or send {formatBdt(invoice.amount_bdt)} yourself</h3>
                    <div>
                      {manualMethods.map((m) => (
                        <div key={m.method} className={styles.walletRow}>
                          <span>{m.label}</span>
                          <span className={m.method === "MANUAL_BANK" ? styles.mono : styles.walletNumber}>{m.detail}</span>
                        </div>
                      ))}
                    </div>
                    <form className={styles.stack} onSubmit={submitManual}>
                      <div>
                        <label className={styles.fieldLabel} htmlFor="invoice-method">
                          Paid with
                        </label>
                        <select id="invoice-method" className={styles.select} value={chosen} onChange={(e) => setMethod(e.target.value as ManualMethod)}>
                          {manualMethods.map((m) => (
                            <option key={m.method} value={m.method}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Input
                        label="Transaction ID"
                        value={transactionId}
                        onChange={(e) => setTransactionId(e.target.value)}
                        minLength={6}
                        maxLength={40}
                        autoComplete="off"
                        required
                        hint={`Use invoice number ${invoice.invoice_number} as the reference when you send the money.`}
                      />
                      <Button type="submit" variant="outline" isLoading={busy === "manual"} disabled={busy !== null}>
                        Submit transaction ID
                      </Button>
                    </form>
                  </section>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </BentoCard>
  );
}
