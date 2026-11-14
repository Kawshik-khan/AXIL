"use client";

import React, { useEffect, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { api, formatBdt, formatDate } from "@/components/payments/api";
import { limitText, type PlanOption } from "@/components/billing/PlanCards";
import { ErrorState, LoadingSkeleton } from "@/components/ui/States/States";
import styles from "./Onboarding.module.css";

interface TrialOffer {
  plan_id: string;
  plan_name: string;
  days: number;
  monthly_price_bdt: number | null;
}

interface Overview {
  plans: PlanOption[];
  trial_offer: TrialOffer | null;
  subscription: { status: string; plan_name: string | null } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The last step: a free trial when this shop still has one (POST /api/v1/billing/trial), stay on Free, or pick a
 * paid plan (POST /api/v1/billing/invoices; the plan starts when that invoice is paid in Plan & billing).
 */
export function PlanStep({ onDone, onBack }: { onDone: (choice: "trial" | "free" | "paid") => Promise<void>; onBack: () => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoadError(null);
    const result = await api<Overview>("/api/v1/billing");
    if (result.ok && result.data) {
      setOverview(result.data);
      const free = result.data.plans.find((p) => (p.monthly_price_bdt ?? 0) === 0);
      setSelected((s) => s ?? (result.data!.trial_offer ? "TRIAL" : free?.id ?? result.data!.plans[0]?.id ?? null));
    } else {
      setLoadError(result.error?.message ?? "Could not load the plans.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (loadError) return <ErrorState message={loadError} onRetry={() => void load()} inline />;
  if (!overview) return <LoadingSkeleton lines={6} inline />;

  const offer = overview.trial_offer;
  const trialPlan = offer ? overview.plans.find((p) => p.id === offer.plan_id) : undefined;
  const chosen = overview.plans.find((p) => p.id === selected);
  const chosenPrice = chosen?.monthly_price_bdt ?? null;
  const isFree = Boolean(chosen && (chosenPrice ?? 0) === 0);
  const trialEnds = offer ? formatDate(new Date(Date.now() + offer.days * DAY_MS).toISOString()) : "";

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (selected === "TRIAL") {
        const result = await api("/api/v1/billing/trial", { method: "POST" });
        if (!result.ok) throw new Error(result.error?.message ?? "Could not start the trial.");
        await onDone("trial");
      } else if (isFree) {
        await onDone("free");
      } else if (chosen) {
        const period = chosen.monthly_price_bdt !== null ? "MONTHLY" : "ANNUAL";
        const result = await api("/api/v1/billing/invoices", { method: "POST", json: { plan_id: chosen.id, billing_period: period } });
        if (!result.ok) throw new Error(result.error?.message ?? "Could not create the invoice.");
        await onDone("paid");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  };

  const ctaLabel =
    selected === "TRIAL" && offer
      ? `Start my ${offer.days}-day free trial`
      : isFree
        ? "Continue on Free"
        : chosen
          ? `Choose ${chosen.name}${chosenPrice ? ` · ${formatBdt(chosenPrice)} a month` : ""}`
          : "Continue";
  const ctaNote =
    selected === "TRIAL"
      ? "No payment now. Nothing is charged when the trial ends."
      : isFree
        ? "Upgrade any time in Plan & billing."
        : "Next you pay the first invoice in Plan & billing. The plan starts when it's paid.";

  return (
    <div className={styles.planStage}>
      <div className={styles.planHead}>
        <span className={styles.tag}>Last step · Your plan</span>
        <h1>{offer ? `Start free for ${offer.days} days` : "Choose your plan"}</h1>
        <p className={styles.lead} style={{ maxWidth: 560 }}>
          {offer
            ? `Use everything in ${offer.plan_name} while you set up and take your first orders. No card or bKash payment needed to start.`
            : overview.subscription
              ? `You're on ${overview.subscription.plan_name ?? "a plan"} already. You can change it any time in Plan & billing.`
              : "Pick what fits your team. You can change it any time in Plan & billing."}
        </p>
      </div>

      {offer && (
        <div className={styles.trialWrap}>
          <button
            type="button"
            className={`${styles.trial} ${selected === "TRIAL" ? styles.trialOn : ""}`}
            aria-pressed={selected === "TRIAL"}
            onClick={() => setSelected("TRIAL")}
          >
            <span className={styles.trialMain}>
              <span className={styles.pill}>Free trial · Recommended</span>
              <span className={styles.trialTitle}>
                {offer.plan_name} <strong>৳0</strong>
                <span>
                  for {offer.days} days{offer.monthly_price_bdt ? `, then ${formatBdt(offer.monthly_price_bdt)} / month if you keep it` : ""}
                </span>
              </span>
              {trialPlan && (
                <ul className={styles.limits}>
                  {trialPlan.limits.map((limit) => (
                    <li key={limit.id}>
                      <span className={styles.check}>
                        <Check size={11} strokeWidth={3.5} />
                      </span>
                      {limitText(limit)}
                    </li>
                  ))}
                </ul>
              )}
            </span>
            <span className={styles.timeline}>
              <strong>How the trial works</strong>
              <span className={styles.when}>
                <i />
                <span>
                  <b>Today</b>Everything in {offer.plan_name}, unlocked
                </span>
              </span>
              <span className={styles.when}>
                <i />
                <span>
                  <b>Before it ends</b>Your plan and its end date are always in Plan &amp; billing
                </span>
              </span>
              <span className={styles.when}>
                <i />
                <span>
                  <b>{trialEnds}</b>Pay to keep {offer.plan_name}, or move to Free. Nothing is charged by itself.
                </span>
              </span>
            </span>
          </button>
        </div>
      )}

      <section aria-labelledby="pick-plan" style={{ display: "grid", gap: 14 }}>
        <div className={styles.plansHead}>
          <h2 id="pick-plan">{offer ? "Or pick a plan now" : "Plans"}</h2>
          <span className={styles.note}>Prices in BDT per month · a paid plan starts when its invoice is paid</span>
        </div>
        <div className={styles.plans} role="radiogroup" aria-label="Plans">
          {overview.plans.map((plan) => {
            const price = plan.monthly_price_bdt;
            const staff = plan.limits.find((l) => l.id === "max_users");
            return (
              <button
                key={plan.id}
                type="button"
                role="radio"
                aria-checked={selected === plan.id}
                className={`${styles.planCard} ${selected === plan.id ? styles.planOn : ""}`}
                onClick={() => setSelected(plan.id)}
              >
                <span className={styles.planTop}>
                  {plan.name}
                  <span className={styles.radio} aria-hidden="true" />
                </span>
                <span className={styles.price}>
                  {price === null ? "—" : price === 0 ? "৳0" : formatBdt(price)}
                  <span>/ month</span>
                </span>
                {plan.description && <p>{plan.description}</p>}
                {staff && <em>{limitText(staff)}</em>}
              </button>
            );
          })}
        </div>
      </section>

      <div className={styles.planActions}>
        {error && (
          <p className={styles.note} role="alert" style={{ color: "var(--color-danger)" }}>
            {error}
          </p>
        )}
        <button type="button" className={styles.cta} onClick={() => void submit()} disabled={busy || !selected}>
          {busy ? "One moment…" : ctaLabel} {!busy && <ArrowRight size={18} />}
        </button>
        <span className={styles.ctaNote}>{ctaNote}</span>
        <button type="button" className={styles.linkButton} onClick={onBack} disabled={busy}>
          Back
        </button>
      </div>
    </div>
  );
}
