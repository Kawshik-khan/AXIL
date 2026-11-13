"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ErrorState, LoadingSkeleton, PermissionDenied } from "@/components/ui/States/States";
import { InvoicePayCard, type BillingInvoice, type BillingPaymentOptions } from "@/components/payments/InvoicePayCard";
import { api, formatBdt, formatDate, GATEWAY_NAMES, type ApiFailure } from "@/components/payments/api";
import { CurrentPlan, PlanCard, yearlySaving, type Period, type PlanOption, type Subscription, type WorkspaceUsage } from "@/components/billing/PlanCards";
import { PERMISSIONS } from "@/lib/permissions";
import legacy from "@/components/payments/Payments.module.css";
import ws from "@/components/ui/WorkScreen/WorkScreen.module.css";
import styles from "@/components/billing/Plans.module.css";

interface Overview {
  subscription: Subscription | null;
  plans: PlanOption[];
  invoices: BillingInvoice[];
  payment_options: BillingPaymentOptions;
  usage: WorkspaceUsage[];
}

const INVOICE_STATUS: Record<BillingInvoice["status"], { label: string; className: string }> = {
  ISSUED: { label: "Unpaid", className: ws.statusWarn },
  PENDING_VERIFICATION: { label: "Being checked", className: ws.statusWarn },
  PAID: { label: "Paid", className: ws.statusOk },
  VOID: { label: "Replaced", className: ws.statusMuted },
};

const METHOD_NAMES: Record<string, string> = { ...GATEWAY_NAMES, MANUAL_BKASH: "bKash (manual)", MANUAL_NAGAD: "Nagad (manual)", MANUAL_BANK: "Bank transfer" };

/** What the gateway round trip reported in the URL. "Paid" is never taken from here, only from the invoice itself. */
const RETURN_NOTES: Record<string, { tone: "warn" | "bad"; text: string }> = {
  cancelled: { tone: "warn", text: "The payment was cancelled. Nothing was charged." },
  failed: { tone: "bad", text: "The payment did not go through. Nothing was recorded." },
  pending: { tone: "warn", text: "We could not confirm the payment yet. If money left your account it will be matched shortly; do not pay twice." },
  test: { tone: "warn", text: "Test payment confirmed by the gateway's sandbox. No real money moved and the invoice was not marked paid." },
};

/**
 * Settings → Plan & billing (ADR-123): compare CommerceOS plans by their real, enforced limits, see this workspace's
 * use against its own, choose a plan (that makes an invoice) and pay it. A plan starts or renews only when the payment
 * is confirmed. Customer payments for orders are under Payments.
 */
export default function BillingPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<(ApiFailure & { status: number }) | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [returned, setReturned] = useState<{ payment: string | null; invoice: string | null }>({ payment: null, invoice: null });
  const [period, setPeriod] = useState<Period>("MONTHLY");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await api<Overview>("/api/v1/billing");
    if (result.ok && result.data) {
      setOverview(result.data);
      setLoadError(null);
    } else if (result.error) {
      setLoadError({ ...result.error, status: result.status });
    }
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setReturned({ payment: query.get("payment"), invoice: query.get("invoice") });
    void api<{ permissions?: string[] }>("/api/v1/auth/session").then((result) => setPermissions(result.data?.permissions ?? []));
    void load();
  }, [load]);

  // Start on the period the workspace already pays by
  useEffect(() => {
    if (overview?.subscription?.billing_period) setPeriod(overview.subscription.billing_period);
  }, [overview?.subscription?.billing_period]);

  const canPay = permissions.includes(PERMISSIONS.SETTINGS_UPDATE);

  const choose = async (plan: PlanOption, chosen: Period) => {
    setActionError(null);
    setBusy(plan.id);
    const result = await api("/api/v1/billing/invoices", { method: "POST", json: { plan_id: plan.id, billing_period: chosen } });
    setBusy(null);
    if (!result.ok) setActionError(result.error?.message ?? "Could not create the invoice.");
    await load();
    if (result.ok) window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (loadError) {
    return loadError.status === 403 ? (
      <PermissionDenied resource="billing" requiredPermission={PERMISSIONS.SETTINGS_READ} />
    ) : (
      <ErrorState message={loadError.message} requestId={loadError.request_id} onRetry={() => void load()} />
    );
  }
  if (!overview) return <LoadingSkeleton lines={6} height="320px" />;

  const { subscription, plans, invoices, payment_options: options, usage } = overview;
  const open = invoices.find((i) => i.status === "ISSUED" || i.status === "PENDING_VERIFICATION");
  const returnedInvoice = returned.invoice ? invoices.find((i) => i.id === returned.invoice) : undefined;
  const note = returned.payment && returnedInvoice?.status !== "PAID" ? RETURN_NOTES[returned.payment] : undefined;
  const planName = (id: string) => plans.find((p) => p.id === id)?.name ?? id;
  const history = invoices.filter((i) => i.id !== open?.id);
  const sellsYearly = plans.some((p) => p.annual_price_bdt !== null);
  const bestSaving = Math.max(0, ...plans.map((p) => yearlySaving(p) ?? 0));
  // The plan CommerceOS highlights (e.g. "Most popular"), unless it's already this workspace's plan
  const featuredId = plans.find((p) => p.highlight_label && !p.is_current)?.id;

  return (
    <div className={ws.page}>
      <header className={ws.header}>
        <div>
          <h1 className={ws.title}>Plan &amp; billing</h1>
          <p className={ws.subtitle}>
            Your CommerceOS plan, what it includes and your invoices. Payments from your own customers are under <Link href="/payments">Payments</Link>.
          </p>
        </div>
        <Link href="/settings" className={ws.quietButton}>
          <ArrowLeft size={14} /> Settings
        </Link>
      </header>

      {returnedInvoice?.status === "PAID" && returned.payment && (
        <div className={`${styles.notice} ${styles.noticeOk}`} role="status">
          <strong>Payment received.</strong> Invoice {returnedInvoice.invoice_number} is paid
          {returnedInvoice.period_end ? ` and your plan runs until ${formatDate(returnedInvoice.period_end)}` : ""}.
          {returnedInvoice.test_mode ? " This was a sandbox (test) payment." : ""}
        </div>
      )}
      {note && (
        <div className={`${styles.notice} ${note.tone === "bad" ? styles.noticeBad : styles.noticeWarn}`} role="status">
          {note.text}
        </div>
      )}
      {actionError && (
        <div className={`${styles.notice} ${styles.noticeBad}`} role="alert">
          {actionError}
        </div>
      )}

      <CurrentPlan subscription={subscription} usage={usage} />

      {open && (
        <div className={legacy.grid}>
          <InvoicePayCard invoice={open} planName={planName(open.plan_id)} options={options} canPay={canPay} onChanged={load} />
        </div>
      )}

      <section aria-labelledby="plans-title" className={ws.page}>
        <div className={styles.plansHead}>
          <div>
            <h2 id="plans-title" className={ws.sectionTitle}>
              Plans
            </h2>
            <p className={ws.sectionHint}>Prices in BDT. Choosing a plan makes an invoice; the plan starts when it's paid. Plans don't renew by themselves.</p>
          </div>
          {sellsYearly && (
            <div className={ws.tabs} role="tablist" aria-label="Billing period">
              {(["MONTHLY", "ANNUAL"] as const).map((p) => (
                <button key={p} type="button" role="tab" aria-selected={period === p} className={`${ws.tab} ${period === p ? ws.tabActive : ""}`} onClick={() => setPeriod(p)}>
                  {p === "MONTHLY" ? "Monthly" : "Yearly"}
                  {p === "ANNUAL" && bestSaving > 0 && <span className={styles.save}>Save up to {bestSaving}%</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {plans.length === 0 ? (
          <div className={ws.section}>
            <div className={ws.empty}>
              <p className={ws.emptyTitle}>No plans are on sale</p>
              <p className={ws.emptyText}>Plans appear here once CommerceOS publishes them.</p>
            </div>
          </div>
        ) : (
          <div className={styles.grid}>
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                period={period}
                usage={usage}
                featured={plan.id === featuredId}
                canPay={canPay}
                busy={busy === plan.id}
                onChoose={(p, chosen) => void choose(p, chosen)}
              />
            ))}
          </div>
        )}
        {!canPay && plans.length > 0 && <p className={styles.footnote}>Only people who can change settings can choose or pay for a plan.</p>}
      </section>

      <section className={ws.section} aria-labelledby="invoices-title">
        <div className={ws.sectionHead}>
          <h2 id="invoices-title" className={ws.sectionTitle}>
            Invoices
          </h2>
        </div>
        {history.length === 0 ? (
          <div className={ws.empty}>
            <p className={ws.emptyTitle}>No invoices yet</p>
            <p className={ws.emptyText}>Invoices you pay are kept here.</p>
          </div>
        ) : (
          <div className={ws.tableScroll}>
            <table className={ws.table}>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th className={ws.numeric}>Amount</th>
                  <th>Period</th>
                  <th>Paid by</th>
                </tr>
              </thead>
              <tbody>
                {history.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className={ws.orderNumber}>{invoice.invoice_number}</td>
                    <td>
                      {planName(invoice.plan_id)} · {invoice.billing_period === "ANNUAL" ? "yearly" : "monthly"}
                    </td>
                    <td>
                      <span className={`${ws.status} ${INVOICE_STATUS[invoice.status].className}`}>{INVOICE_STATUS[invoice.status].label}</span>{" "}
                      {invoice.test_mode && <span className={`${ws.tag} ${ws.tagWarn}`}>TEST</span>}
                    </td>
                    <td className={ws.numeric}>{formatBdt(invoice.amount_bdt)}</td>
                    <td>{invoice.period_start ? `${formatDate(invoice.period_start)} – ${formatDate(invoice.period_end)}` : "—"}</td>
                    <td>
                      {invoice.payment_method ? METHOD_NAMES[invoice.payment_method] ?? invoice.payment_method : "—"}
                      {invoice.paid_at ? ` · ${formatDate(invoice.paid_at)}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
