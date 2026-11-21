"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { InvoicePayCard, type BillingInvoice, type BillingPaymentOptions } from "@/components/payments/InvoicePayCard";
import { api, formatBdt, formatDate } from "@/components/payments/api";
import { limitText, type PlanOption } from "@/components/billing/PlanCards";
import { activationInvoices } from "@/components/billing/activation-invoice";
import { ErrorState, LoadingSkeleton } from "@/components/ui/States/States";
import { PERMISSIONS } from "@/lib/permissions";
import stage from "@/app/(auth)/stage.module.css";
import styles from "./activate.module.css";

type AccessState = "ACTIVE" | "GRACE" | "SETUP_REQUIRED" | "PAYMENT_REQUIRED" | "PAYMENT_PENDING" | "LOCKED";

interface Access {
  state: AccessState;
  paywalled: boolean;
  next_path: string | null;
  grace_ends_at: string | null;
}

interface Overview {
  subscription: { status: string; plan_name: string | null; trial_ends_at?: string | null } | null;
  plans: PlanOption[];
  invoices: BillingInvoice[];
  payment_options: BillingPaymentOptions;
  trial_offer: { plan_id: string; plan_name: string; days: number } | null;
  access: Access;
}

/** What the gateway round trip put in the URL. "Paid" is never taken from here, only from the invoice itself. */
const RETURN_NOTES: Record<string, { tone: "warn" | "bad"; text: string }> = {
  cancelled: { tone: "warn", text: "The payment was cancelled. Nothing was charged." },
  failed: { tone: "bad", text: "The payment did not go through. Nothing was recorded. You can try again." },
  pending: { tone: "warn", text: "We're confirming your payment with the gateway. If money left your account it will be matched shortly; don't pay twice." },
  test: { tone: "warn", text: "Test payment confirmed by the gateway's sandbox. No real money moved and the invoice was not marked paid." },
};

const HEADINGS: Record<AccessState, { title: string; lead: string }> = {
  PAYMENT_REQUIRED: { title: "Activate your workspace", lead: "Your shop is set up. Pay for your plan and your dashboard opens right away." },
  PAYMENT_PENDING: { title: "We're checking your payment", lead: "A CommerceOS operator is confirming your transaction. Your workspace opens as soon as it's confirmed." },
  LOCKED: { title: "Your subscription has ended", lead: "Your shop's data is safe. Pay for a plan to open your workspace again." },
  GRACE: { title: "Your payment is overdue", lead: "You can still use CommerceOS for now. Pay the invoice to keep it that way." },
  ACTIVE: { title: "Payment confirmed", lead: "Your workspace is open." },
  SETUP_REQUIRED: { title: "Finish setting up first", lead: "Taking you back to shop setup." },
};

const POLL_MS = 3000;
const POLL_FOR_MS = 60_000;

/**
 * The paywall (ADR-125): a workspace from the public sign-up lands here after setup until its plan is paid. It shows
 * the open invoice and the ways to pay it, or the paid plans to choose from (and the free trial when one is on offer).
 * Access comes only from the server's WorkspaceAccessService; this page never decides it.
 */
export default function ActivatePage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [canPay, setCanPay] = useState(false);
  const [returned, setReturned] = useState<{ payment: string | null; invoice: string | null }>({ payment: null, invoice: null });
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const pollStarted = useRef(0);

  const load = useCallback(async (): Promise<Overview | null> => {
    const result = await api<Overview>("/api/v1/billing");
    if (result.status === 401) {
      window.location.replace("/login");
      return null;
    }
    if (!result.ok || !result.data) {
      setLoadError(result.error?.message ?? "Could not load your plan.");
      return null;
    }
    const data = result.data;
    const search = window.location.search;
    // Not paywalled: the normal Plan & billing page handles it. Setup not finished: back to setup.
    if (!data.access.paywalled) {
      window.location.replace(`/settings/billing${search}`);
      return null;
    }
    if (data.access.state === "SETUP_REQUIRED") {
      window.location.replace("/onboarding");
      return null;
    }
    const paid = data.plans.filter((p) => (p.monthly_price_bdt ?? p.annual_price_bdt ?? 0) > 0);
    setOverview({ ...data, plans: paid });
    // A past-due invoice can't be paid any more: offer its plan again first, so a new invoice is one click away
    const expiredPlan = activationInvoices(data.invoices).expired?.plan_id;
    const again = expiredPlan && paid.some((p) => p.id === expiredPlan) ? expiredPlan : null;
    setSelected((s) => s ?? again ?? (data.trial_offer ? "TRIAL" : paid.find((p) => p.highlight_label)?.id ?? paid[0]?.id ?? null));
    setLoadError(null);
    return data;
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setReturned({ payment: query.get("payment"), invoice: query.get("invoice") });
    void api<{ permissions?: string[] }>("/api/v1/auth/session").then((r) => setCanPay((r.data?.permissions ?? []).includes(PERMISSIONS.SETTINGS_UPDATE)));
    void load();
  }, [load]);

  // Back from the gateway: the callback may land a moment after the browser does, so check again for a while
  useEffect(() => {
    if (!overview || !returned.payment || overview.access.state === "ACTIVE") return;
    if (!pollStarted.current) pollStarted.current = Date.now();
    if (Date.now() - pollStarted.current > POLL_FOR_MS) {
      setPolling(false);
      return;
    }
    setPolling(true);
    const timer = window.setTimeout(() => void load(), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [overview, returned.payment, load]);

  // Access granted: into the dashboard
  useEffect(() => {
    if (overview?.access.state !== "ACTIVE") return;
    const timer = window.setTimeout(() => window.location.replace("/"), 1200);
    return () => window.clearTimeout(timer);
  }, [overview?.access.state]);

  const signOut = async () => {
    await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" }).catch(() => undefined);
    window.location.replace("/login");
  };

  const choose = async () => {
    if (!overview || !selected) return;
    setActionError(null);
    setBusy(selected);
    const result =
      selected === "TRIAL"
        ? await api("/api/v1/billing/trial", { method: "POST" })
        : await api("/api/v1/billing/invoices", {
            method: "POST",
            json: { plan_id: selected, billing_period: overview.plans.find((p) => p.id === selected)?.monthly_price_bdt !== null ? "MONTHLY" : "ANNUAL" },
          });
    setBusy(null);
    if (!result.ok) setActionError(result.error?.message ?? "Could not continue. Try again.");
    await load();
  };

  const frame = (body: React.ReactNode) => (
    <main className={stage.page}>
      <header className={stage.top}>
        <span className={stage.brandMark}>
          <BrandLogo size={34} tile /> CommerceOS
        </span>
        <button type="button" className={`${stage.back} ${styles.signOut}`} onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <div className={styles.wrap}>{body}</div>
    </main>
  );

  if (loadError) return frame(<ErrorState message={loadError} onRetry={() => void load()} />);
  if (!overview) return frame(<LoadingSkeleton lines={6} />);

  const { access, invoices, payment_options: options, plans, trial_offer: offer } = overview;
  const heading = HEADINGS[access.state];
  // Only a payable invoice counts as open; a past-due one is replaced by choosing the plan again (ADR-125)
  const { open, expired } = activationInvoices(invoices);
  const returnedInvoice = returned.invoice ? invoices.find((i) => i.id === returned.invoice) : undefined;
  const note = returned.payment && returnedInvoice?.status !== "PAID" ? RETURN_NOTES[returned.payment] : undefined;
  const planName = (id: string) => plans.find((p) => p.id === id)?.name ?? id;

  if (access.state === "ACTIVE") {
    return frame(
      <section className={styles.done} role="status">
        <span className={styles.doneIcon} aria-hidden="true">
          <Check size={22} strokeWidth={3} />
        </span>
        <h1 className={styles.title}>{heading.title}</h1>
        <p className={styles.lead}>Opening your dashboard…</p>
        <a href="/" className={styles.cta}>
          Open my dashboard <ArrowRight size={16} />
        </a>
      </section>
    );
  }

  return frame(
    <>
      <div className={styles.head}>
        <h1 className={styles.title}>{heading.title}</h1>
        <p className={styles.lead}>{heading.lead}</p>
        {access.state === "GRACE" && access.grace_ends_at && <p className={styles.lead}>Access stops on {formatDate(access.grace_ends_at)} unless the invoice is paid.</p>}
      </div>

      {note && (
        <div className={`${styles.notice} ${note.tone === "bad" ? styles.noticeBad : ""}`} role="status">
          {note.text}
          {polling && " Checking…"}
        </div>
      )}

      {open ? (
        <InvoicePayCard invoice={open} planName={planName(open.plan_id)} options={options} canPay={canPay} onChanged={async () => {
          await load();
        }} />
      ) : !canPay ? (
        <div className={styles.notice} role="status">
          Only the shop owner or an admin can choose and pay for a plan. Ask them to sign in and finish this step.
        </div>
      ) : (
        <section className={styles.plans} aria-labelledby="activate-plans">
          {expired && (
            <div className={styles.notice} role="status">
              Invoice {expired.invoice_number} passed its due date on {formatDate(expired.due_date)}, so it can&apos;t be paid any more.
              Choose your plan again to get a new invoice; nothing was charged.
            </div>
          )}
          <h2 id="activate-plans" className={styles.subTitle}>
            Choose your plan
          </h2>
          <div className={styles.planGrid} role="radiogroup" aria-label="Plans">
            {offer && (
              <button type="button" role="radio" aria-checked={selected === "TRIAL"} className={`${styles.plan} ${selected === "TRIAL" ? styles.planOn : ""}`} onClick={() => setSelected("TRIAL")}>
                <span className={styles.planName}>Free trial · {offer.plan_name}</span>
                <span className={styles.price}>
                  ৳0 <span>for {offer.days} days</span>
                </span>
                <span className={styles.planNote}>No payment now. Pay before it ends to keep using CommerceOS.</span>
              </button>
            )}
            {plans.map((plan) => (
              <button key={plan.id} type="button" role="radio" aria-checked={selected === plan.id} className={`${styles.plan} ${selected === plan.id ? styles.planOn : ""}`} onClick={() => setSelected(plan.id)}>
                <span className={styles.planName}>
                  {plan.name}
                  {plan.highlight_label && <em className={styles.pill}>{plan.highlight_label}</em>}
                </span>
                <span className={styles.price}>
                  {plan.monthly_price_bdt !== null ? formatBdt(plan.monthly_price_bdt) : formatBdt(plan.annual_price_bdt ?? 0)}
                  <span>{plan.monthly_price_bdt !== null ? "/ month" : "/ year"}</span>
                </span>
                {plan.setup_fee_bdt > 0 && <span className={styles.planNote}>+ {formatBdt(plan.setup_fee_bdt)} one-time setup fee</span>}
                <ul className={styles.limits}>
                  {plan.limits.slice(0, 4).map((limit) => (
                    <li key={limit.id}>{limitText(limit)}</li>
                  ))}
                </ul>
              </button>
            ))}
          </div>
          {plans.length === 0 && !offer && <div className={styles.notice}>No plan is on sale right now. Contact CommerceOS support.</div>}
          {actionError && (
            <div className={`${styles.notice} ${styles.noticeBad}`} role="alert">
              {actionError}
            </div>
          )}
          <button type="button" className={styles.cta} onClick={() => void choose()} disabled={!selected || busy !== null}>
            {busy ? "One moment…" : selected === "TRIAL" ? "Start my free trial" : "Continue to payment"} {!busy && <ArrowRight size={16} />}
          </button>
        </section>
      )}
    </>
  );
}
