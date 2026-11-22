"use client";

import React, { useState } from "react";
import { ArrowRight, Check, ChevronRight, CreditCard, Landmark, Lock, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/Button/Button";
import { api, formatBdt, formatDate } from "./api";
import { MethodMark } from "./payment-ui";
import legacy from "./Payments.module.css";
import styles from "./InvoicePayCard.module.css";

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
type MethodTab = "MOBILE" | "CARD" | "BANK";
type WalletId = "BKASH" | "NAGAD" | "ROCKET";

/** How one wallet is paid with the platform's current settings: through a gateway, or by sending money by hand. */
type WalletRoute =
  | { id: WalletId; name: string; mode: "ONLINE"; provider: string }
  | { id: WalletId; name: string; mode: "MANUAL"; method: ManualMethod; number: string };

/** The platform's billing support contact (billing.support_contact), as the billing API returns it. */
export interface BillingSupportContact {
  kind: "WHATSAPP" | "EMAIL";
  value: string;
}

/** Who the invoice is for (the billing overview's billed_to): the workspace and the signed-in payer. */
export interface BilledTo {
  workspace_name: string;
  payer_name: string;
  payer_email: string;
}

/** Two letters for the workspace badge: the first letters of its first two words. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase() || "W";
}

/** A link that opens a chat or email to support with the invoice number already written. */
function supportHref(contact: BillingSupportContact, invoiceNumber: string): string {
  const text = `Hello CommerceOS, I want to pay invoice ${invoiceNumber} but can't pay it from the website.`;
  if (contact.kind === "EMAIL") {
    return `mailto:${encodeURIComponent(contact.value)}?subject=${encodeURIComponent(`Paying invoice ${invoiceNumber}`)}&body=${encodeURIComponent(text)}`;
  }
  return `https://wa.me/88${contact.value}?text=${encodeURIComponent(text)}`;
}

/**
 * Which wallets can be used, and how. bKash goes to its own gateway when it is set up, otherwise through SSLCommerz;
 * Nagad and Rocket only reach us through SSLCommerz. Without a gateway, a wallet with a published number is paid by
 * Send Money plus a transaction id that an operator checks.
 */
function walletRoutes(options: BillingPaymentOptions): WalletRoute[] {
  const hasBkash = options.gateways.includes("BKASH");
  const hasSsl = options.gateways.includes("SSLCOMMERZ");
  const routes: WalletRoute[] = [];
  if (hasBkash) routes.push({ id: "BKASH", name: "bKash", mode: "ONLINE", provider: "BKASH" });
  else if (hasSsl) routes.push({ id: "BKASH", name: "bKash", mode: "ONLINE", provider: "SSLCOMMERZ" });
  else if (options.manual.bkash_number) routes.push({ id: "BKASH", name: "bKash", mode: "MANUAL", method: "MANUAL_BKASH", number: options.manual.bkash_number });
  if (hasSsl) routes.push({ id: "NAGAD", name: "Nagad", mode: "ONLINE", provider: "SSLCOMMERZ" });
  else if (options.manual.nagad_number) routes.push({ id: "NAGAD", name: "Nagad", mode: "MANUAL", method: "MANUAL_NAGAD", number: options.manual.nagad_number });
  if (hasSsl) routes.push({ id: "ROCKET", name: "Rocket", mode: "ONLINE", provider: "SSLCOMMERZ" });
  return routes;
}

const TAB_LABELS: Record<MethodTab, string> = { MOBILE: "Mobile banking", CARD: "Card", BANK: "Bank transfer" };
const TAB_ICONS: Record<MethodTab, React.ReactNode> = {
  MOBILE: <Smartphone size={22} strokeWidth={1.8} aria-hidden />,
  CARD: <CreditCard size={22} strokeWidth={1.8} aria-hidden />,
  BANK: <Landmark size={22} strokeWidth={1.8} aria-hidden />,
};

function headingFor(invoice: BillingInvoice, planName: string): string {
  if (invoice.kind === "RENEWAL") return `Renew ${planName}`;
  if (invoice.kind === "PLAN_CHANGE") return `Switch to ${planName}`;
  return `Start ${planName}`;
}

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
  trialOffer = null,
  supportContact = null,
  billedTo = null,
}: {
  invoice: BillingInvoice;
  planName: string;
  options: BillingPaymentOptions;
  canPay: boolean;
  onChanged: () => Promise<void> | void;
  /** The workspace's one free trial, when on offer: the way in while this invoice can't be paid. */
  trialOffer?: { plan_name: string; days: number } | null;
  supportContact?: BillingSupportContact | null;
  billedTo?: BilledTo | null;
}) {
  const wallets = walletRoutes(options);
  const tabs: MethodTab[] = [];
  if (wallets.length > 0) tabs.push("MOBILE");
  if (options.gateways.includes("SSLCOMMERZ")) tabs.push("CARD");
  if (options.manual.bank_details) tabs.push("BANK");

  const [tabChoice, setTab] = useState<MethodTab | null>(null);
  const [walletChoice, setWallet] = useState<WalletId | null>(null);
  const [phone, setPhone] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tab = tabChoice && tabs.includes(tabChoice) ? tabChoice : tabs[0];
  const wallet = wallets.find((w) => w.id === walletChoice) ?? wallets[0];
  const amount = formatBdt(invoice.amount_bdt);
  const pending = invoice.status === "PENDING_VERIFICATION";

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

  const startTrial = async () => {
    setError(null);
    setBusy("trial");
    const result = await api("/api/v1/billing/trial", { method: "POST" });
    setBusy(null);
    if (!result.ok) setError(result.error?.message ?? "Could not start the trial.");
    await onChanged();
  };

  const submitManual = async (method: ManualMethod) => {
    setError(null);
    if (transactionId.trim().length < 6) {
      setError("Enter the transaction ID from your receipt (at least 6 characters).");
      return;
    }
    setBusy("manual");
    const result = await api(`/api/v1/billing/invoices/${encodeURIComponent(invoice.id)}/manual-payment`, {
      method: "POST",
      json: { method, transaction_id: transactionId.trim() },
    });
    setBusy(null);
    if (!result.ok) setError(result.error?.message ?? "Could not submit the transaction ID.");
    else setTransactionId("");
    await onChanged();
  };

  /** What the one button does for the current choice. */
  const action: { label: string; run: () => void; note: string } | null =
    tab === "MOBILE" && wallet
      ? wallet.mode === "ONLINE"
        ? {
            label: busy ? `Opening ${wallet.name}…` : `Pay ${amount} with ${wallet.name}`,
            run: () => void payOnline(wallet.provider),
            note: "You'll leave CommerceOS to approve the payment, then come straight back here.",
          }
        : {
            label: busy ? "Submitting…" : "Submit transaction ID",
            run: () => void submitManual(wallet.method),
            note: `An operator matches your payment to invoice ${invoice.invoice_number}.`,
          }
      : tab === "CARD"
        ? {
            label: busy ? "Opening SSLCommerz…" : "Continue to SSLCommerz",
            run: () => void payOnline("SSLCOMMERZ"),
            note: "You'll leave CommerceOS to pay, then come straight back here.",
          }
        : tab === "BANK"
          ? {
              label: busy ? "Submitting…" : "Submit transaction ID",
              run: () => void submitManual("MANUAL_BANK"),
              note: `An operator matches the transfer to invoice ${invoice.invoice_number}.`,
            }
          : null;

  const needsPhone = (tab === "MOBILE" && wallet?.mode === "ONLINE") || tab === "CARD";
  const needsTransactionId = (tab === "MOBILE" && wallet?.mode === "MANUAL") || tab === "BANK";

  const phoneField = (
    <div className={styles.field}>
      <label htmlFor="invoice-payer-phone" className={styles.label}>
        {tab === "MOBILE" && wallet ? `${wallet.name} account number` : "Payer's mobile number"}
      </label>
      <div className={styles.phoneBox}>
        <span className={styles.prefix}>+88</span>
        <input
          id="invoice-payer-phone"
          className={styles.phoneInput}
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="01XXXXXXXXX"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <span className={styles.hint}>The gateway asks for it; you approve with your PIN or card on their page.</span>
    </div>
  );

  const transactionField = (
    <div className={styles.field}>
      <label htmlFor="invoice-transaction-id" className={styles.label}>
        Transaction ID
      </label>
      <input
        id="invoice-transaction-id"
        className={styles.input}
        placeholder="From your receipt"
        autoComplete="off"
        minLength={6}
        maxLength={40}
        value={transactionId}
        onChange={(e) => setTransactionId(e.target.value)}
      />
      <span className={styles.hint}>Your plan starts as soon as a CommerceOS operator confirms the payment.</span>
    </div>
  );

  let body: React.ReactNode;
  if (pending) {
    body = (
      <div className={legacy.notice} role="status">
        <strong>We are checking your payment.</strong> You submitted transaction ID <span className={legacy.mono}>{invoice.manual_transaction_id}</span>. Your
        plan starts as soon as a CommerceOS operator confirms it; nothing else is needed from you.
      </div>
    );
  } else if (!canPay) {
    body = <p className={legacy.muted}>Only an owner or admin can pay this invoice (needs settings.update).</p>;
  } else if (tabs.length === 0) {
    body = (
      <div className={styles.section}>
        <div className={legacy.noticeWarning} role="status">
          <strong>Payment isn&apos;t open yet.</strong> Paying for plans online isn&apos;t switched on yet, so this invoice can&apos;t be paid from
          here. Your invoice is saved{trialOffer ? "; start your free trial now and pay it later" : ""}
          {supportContact ? ", or message CommerceOS support and they'll help you pay it." : "."}
        </div>
        {trialOffer && (
          <Button type="button" onClick={() => void startTrial()} isLoading={busy === "trial"} disabled={busy !== null}>
            Start my {trialOffer.days}-day free trial of {trialOffer.plan_name}
          </Button>
        )}
        {supportContact && (
          <a className={styles.supportLink} href={supportHref(supportContact, invoice.invoice_number)} target="_blank" rel="noopener noreferrer">
            <span>
              {supportContact.kind === "WHATSAPP" ? "Message support on WhatsApp" : "Email CommerceOS support"}
              <br />
              <span className={styles.hint}>Invoice {invoice.invoice_number} is already in the message</span>
            </span>
            <ChevronRight size={18} aria-hidden />
          </a>
        )}
      </div>
    );
  } else {
    body = (
      <>
        <section className={styles.section} aria-labelledby="invoice-method-label">
          <p id="invoice-method-label" className={styles.label}>
            Payment method
          </p>
          <div className={styles.methods} role="radiogroup" aria-labelledby="invoice-method-label">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={tab === t}
                className={`${styles.method} ${tab === t ? styles.methodOn : ""}`}
                onClick={() => {
                  setTab(t);
                  setError(null);
                }}
              >
                {TAB_ICONS[t]}
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>

          {tab === "MOBILE" && wallet && (
            <>
              <div className={styles.sectionHead}>
                <h3 className={styles.sectionTitle}>Pay with mobile banking</h3>
                <span className={styles.count}>
                  {wallets.length} {wallets.length === 1 ? "option" : "options"}
                </span>
              </div>
              <div className={styles.wallets} role="radiogroup" aria-label="Wallet">
                {wallets.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    role="radio"
                    aria-checked={wallet.id === w.id}
                    className={`${styles.wallet} ${wallet.id === w.id ? styles.walletOn : ""}`}
                    onClick={() => {
                      setWallet(w.id);
                      setError(null);
                    }}
                  >
                    <MethodMark provider={w.id} />
                    {w.name}
                    {wallet.id === w.id && (
                      <span className={styles.check} aria-hidden>
                        <Check size={12} strokeWidth={3.2} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className={styles.info}>
                <MethodMark provider={wallet.id} />
                <div className={styles.infoBody}>
                  <span className={styles.infoTitle}>
                    {wallet.name}
                    {wallet.mode === "ONLINE" ? (
                      <>
                        <span className={styles.chipInstant}>● Instant</span>
                        {wallet.provider === "SSLCOMMERZ" && <span className={styles.count}>via SSLCommerz</span>}
                      </>
                    ) : (
                      <span className={styles.chipReview}>Checked by an operator</span>
                    )}
                  </span>
                  <p className={styles.infoText}>
                    {wallet.mode === "ONLINE"
                      ? wallet.provider === "BKASH"
                        ? "You'll finish on bKash's secure page. Your PIN is never shared with CommerceOS."
                        : `You'll finish on SSLCommerz's secure page and choose ${wallet.name} there. Your PIN is never shared with CommerceOS.`
                      : `Send ${amount} with ${wallet.name} Send Money to the number below, using invoice ${invoice.invoice_number} as the reference, then enter the transaction ID.`}
                  </p>
                </div>
              </div>
              {wallet.mode === "MANUAL" && (
                <dl className={styles.details}>
                  <div className={styles.detailRow}>
                    <dt>{wallet.name} number</dt>
                    <dd className={styles.mono}>{wallet.number}</dd>
                  </div>
                  <div className={styles.detailRef}>
                    <dt>Reference</dt>
                    <dd className={styles.mono}>{invoice.invoice_number}</dd>
                  </div>
                </dl>
              )}
            </>
          )}

          {tab === "CARD" && (
            <>
              <h3 className={styles.sectionTitle}>Pay by card or internet banking</h3>
              <div className={styles.chips}>
                <span className={styles.chip}>Visa</span>
                <span className={styles.chip}>Mastercard</span>
                <span className={styles.chip}>Amex</span>
                <span className={styles.chip}>Internet banking</span>
              </div>
              <div className={styles.info}>
                <span className={styles.lockMark} aria-hidden>
                  <Lock size={16} strokeWidth={2} />
                </span>
                <div className={styles.infoBody}>
                  <span className={styles.infoTitle}>Secured by SSLCommerz</span>
                  <p className={styles.infoText}>You&apos;ll type your card details on SSLCommerz&apos;s page, not here. CommerceOS never sees or stores your card number.</p>
                </div>
              </div>
            </>
          )}

          {tab === "BANK" && (
            <>
              <div className={styles.sectionHead}>
                <h3 className={styles.sectionTitle}>Send {amount} by bank transfer</h3>
                <span className={styles.chipReview}>Checked by an operator</span>
              </div>
              <dl className={styles.details}>
                <div className={styles.detailRow}>
                  <dt>Bank details</dt>
                  <dd>{options.manual.bank_details}</dd>
                </div>
                <div className={styles.detailRef}>
                  <dt>Reference</dt>
                  <dd className={styles.mono}>{invoice.invoice_number}</dd>
                </div>
              </dl>
            </>
          )}

          {needsPhone && phoneField}
          {needsTransactionId && transactionField}
        </section>

        {action && (
          <>
            <button type="button" className={styles.pay} onClick={action.run} disabled={busy !== null}>
              {action.label}
              <ArrowRight size={18} strokeWidth={2} aria-hidden />
            </button>
            <p className={styles.fine}>{action.note}</p>
          </>
        )}
      </>
    );
  }

  return (
    <section className={styles.checkout} aria-label={`Pay invoice ${invoice.invoice_number}`}>
      <div className={styles.form}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>Invoice {invoice.invoice_number}</p>
          <h2 className={styles.title}>{headingFor(invoice, planName)}</h2>
          <p className={styles.lead}>Your plan changes the moment the payment is confirmed. Nothing is charged until you approve it.</p>
        </header>

        {billedTo && (
          <div className={styles.field}>
            <span className={styles.label}>Billed to</span>
            <div className={styles.billedTo}>
              <span className={styles.badge} aria-hidden>
                {initials(billedTo.workspace_name)}
              </span>
              <span className={styles.billedName}>{billedTo.workspace_name}</span>
              <span className={styles.billedMeta}>Receipt to {billedTo.payer_email}</span>
            </div>
          </div>
        )}

        {!pending && invoice.manual_rejection_reason && (
          <div className={legacy.noticeDanger} role="alert">
            Your last payment could not be confirmed: {invoice.manual_rejection_reason} Check the transaction ID and submit it again.
          </div>
        )}
        {error && (
          <div className={legacy.noticeDanger} role="alert">
            {error}
          </div>
        )}

        {body}
      </div>

      <aside className={styles.summary} aria-label="Invoice summary">
        <div className={styles.summaryCard}>
          <div className={styles.summaryHead}>
            <h3 className={styles.summaryTitle}>{planName} plan</h3>
            {invoice.test_mode && <span className={styles.chipReview}>Sandbox</span>}
          </div>

          <div className={styles.period}>
            <span className={styles.radio} aria-hidden />
            <span className={styles.periodText}>
              <strong>{invoice.billing_period === "ANNUAL" ? "Pay yearly" : "Pay monthly"}</strong>
              {formatBdt(invoice.plan_price_bdt)} / {invoice.billing_period === "ANNUAL" ? "year" : "month"} · per workspace
            </span>
          </div>

          <dl className={styles.lines}>
            <div>
              <dt>
                {planName} · {invoice.billing_period === "ANNUAL" ? "1 year" : "1 month"}
              </dt>
              <dd>{formatBdt(invoice.plan_price_bdt)}</dd>
            </div>
            {invoice.setup_fee_bdt > 0 && (
              <div>
                <dt>One-time setup fee</dt>
                <dd>{formatBdt(invoice.setup_fee_bdt)}</dd>
              </div>
            )}
            {invoice.period_start && invoice.period_end && (
              <div>
                <dt>Billing period</dt>
                <dd>
                  {formatDate(invoice.period_start)} – {formatDate(invoice.period_end)}
                </dd>
              </div>
            )}
            <div>
              <dt>Due</dt>
              <dd>{formatDate(invoice.due_date)}</dd>
            </div>
            <div>
              <dt>Invoice</dt>
              <dd className={styles.mono}>{invoice.invoice_number}</dd>
            </div>
          </dl>

          <hr className={styles.rule} />

          <div className={styles.total}>
            <span className={styles.totalLabel}>Total due</span>
            <span className={styles.totalAmount}>{amount}</span>
          </div>

          <p className={styles.secure}>
            <Lock size={14} aria-hidden />
            <span>The plan changes only after the gateway or an operator confirms the money arrived. If a payment fails, nothing is charged and your current plan stays.</span>
          </p>
        </div>
        <div className={styles.art} aria-hidden />
      </aside>
    </section>
  );
}
