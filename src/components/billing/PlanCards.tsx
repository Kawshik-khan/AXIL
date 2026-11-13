"use client";

import React from "react";
import { AlertTriangle, Check, Minus } from "lucide-react";
import { formatBdt, formatDate } from "@/components/payments/api";
import ws from "@/components/ui/WorkScreen/WorkScreen.module.css";
import styles from "./Plans.module.css";

export type LimitValue = number | boolean | null;

export interface PlanLimit {
  id: string;
  label: string;
  unit?: string;
  kind: "COUNT_LIMIT" | "PERIOD_QUOTA" | "FEATURE";
  value: LimitValue;
}

export interface WorkspaceUsage extends PlanLimit {
  used: number | null;
}

export interface PlanOption {
  id: string;
  name: string;
  description: string;
  highlight_label: string | null;
  monthly_price_bdt: number | null;
  annual_price_bdt: number | null;
  setup_fee_bdt: number;
  is_current: boolean;
  limits: PlanLimit[];
}

export interface Subscription {
  status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED" | "EXPIRED";
  plan_id: string;
  plan_name: string | null;
  billing_period?: "MONTHLY" | "ANNUAL";
  trial_ends_at?: string;
  current_period_end: string;
}

export type Period = "MONTHLY" | "ANNUAL";

const STATUS: Record<Subscription["status"], { label: string; className: string }> = {
  ACTIVE: { label: "Active", className: ws.statusOk },
  TRIAL: { label: "Trial", className: ws.statusWarn },
  PAST_DUE: { label: "Payment overdue", className: ws.statusDanger },
  CANCELLED: { label: "Cancelled", className: ws.statusMuted },
  EXPIRED: { label: "Expired", className: ws.statusDanger },
};

const fmt = (n: number) => n.toLocaleString("en-US");

/** "Up to 5 staff users", "Unlimited catalog products", or the feature's name. */
export function limitText(limit: PlanLimit): string {
  if (limit.kind === "FEATURE") return limit.label;
  // Lower-case the first word for mid-sentence use, but keep acronyms ("AI agent runs")
  const label = /^[A-Z]{2}/.test(limit.label) ? limit.label : limit.label.charAt(0).toLowerCase() + limit.label.slice(1);
  if (limit.value === null || limit.value === true) return `Unlimited ${label}`;
  if (limit.value === false || limit.value === 0) return `No ${label}`;
  return `Up to ${fmt(limit.value)} ${label}`;
}

/** The plan's yearly saving against twelve monthly payments, in whole percent; null when it isn't cheaper. */
export function yearlySaving(plan: Pick<PlanOption, "monthly_price_bdt" | "annual_price_bdt">): number | null {
  if (!plan.monthly_price_bdt || !plan.annual_price_bdt) return null;
  const pct = Math.round((1 - plan.annual_price_bdt / (plan.monthly_price_bdt * 12)) * 100);
  return pct > 0 ? pct : null;
}

/** The plan in force, its renewal date, and use against each enforced limit. */
export function CurrentPlan({ subscription, usage }: { subscription: Subscription | null; usage: WorkspaceUsage[] }) {
  const meters = usage.filter((u) => u.kind !== "FEATURE" && u.used !== null);
  const status = subscription ? STATUS[subscription.status] : null;
  return (
    <section className={ws.section} aria-label="Current plan">
      <div className={styles.current}>
        <div>
          <span className={ws.statLabel}>Current plan</span>
          <p className={styles.currentName}>{subscription ? subscription.plan_name ?? subscription.plan_id : "No plan yet"}</p>
          {subscription && status ? (
            <>
              <span className={`${ws.status} ${status.className}`}>{status.label}</span>
              <p className={styles.currentMeta}>
                {subscription.status === "TRIAL"
                  ? `Trial ends ${formatDate(subscription.trial_ends_at ?? subscription.current_period_end)}.`
                  : `${subscription.billing_period === "ANNUAL" ? "Yearly" : "Monthly"} · paid until ${formatDate(subscription.current_period_end)}.`}
              </p>
            </>
          ) : (
            <p className={styles.currentMeta}>Choose a plan below to start.</p>
          )}
        </div>
        <div className={styles.meters}>
          {meters.map((m) => {
            const cap = typeof m.value === "number" ? m.value : null;
            const ratio = cap && cap > 0 ? Math.min(1, (m.used ?? 0) / cap) : 0;
            const tone = ratio >= 1 ? styles.fillFull : ratio >= 0.8 ? styles.fillWarn : "";
            return (
              <div key={m.id} className={styles.meter}>
                <div className={styles.meterHead}>
                  <span>{m.label}</span>
                  <span className={styles.meterValue}>
                    {fmt(m.used ?? 0)}
                    {cap !== null ? ` / ${fmt(cap)}` : ""}
                  </span>
                </div>
                <div className={styles.track} role="meter" aria-label={m.label} aria-valuenow={m.used ?? 0} aria-valuemin={0} aria-valuemax={cap ?? undefined}>
                  <div className={`${styles.fill} ${tone}`} style={{ width: `${cap === null ? 0 : Math.max(ratio * 100, m.used ? 2 : 0)}%` }} />
                </div>
                <span className={styles.meterNote}>
                  {cap === null
                    ? "Unlimited on your plan"
                    : ratio >= 1
                      ? "Limit reached"
                      : m.kind === "PERIOD_QUOTA"
                        ? `${fmt(cap - (m.used ?? 0))} left this month`
                        : `${fmt(cap - (m.used ?? 0))} left`}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** A limit this workspace already uses more of than `plan` allows, so switching would block adding more. */
function overLimits(plan: PlanOption, usage: WorkspaceUsage[]): string[] {
  return plan.limits.flatMap((limit) => {
    const used = usage.find((u) => u.id === limit.id)?.used;
    if (typeof limit.value !== "number" || used == null || used <= limit.value || limit.kind === "PERIOD_QUOTA") return [];
    return [`You have ${fmt(used)} ${limit.unit ?? limit.label.toLowerCase()}; this plan allows ${fmt(limit.value)}.`];
  });
}

export function PlanCard({
  plan,
  period,
  usage,
  featured,
  canPay,
  busy,
  onChoose,
}: {
  plan: PlanOption;
  period: Period;
  usage: WorkspaceUsage[];
  featured: boolean;
  canPay: boolean;
  busy: boolean;
  onChoose: (plan: PlanOption, period: Period) => void;
}) {
  const price = period === "ANNUAL" ? plan.annual_price_bdt : plan.monthly_price_bdt;
  const free = price === 0;
  const saving = period === "ANNUAL" ? yearlySaving(plan) : null;
  const warnings = plan.is_current ? [] : overLimits(plan, usage);
  const ctaLabel = plan.is_current ? (period === "ANNUAL" ? "Renew for a year" : "Renew for a month") : `Choose ${plan.name}`;

  return (
    <article className={`${styles.card} ${plan.is_current ? styles.cardCurrent : featured ? styles.cardFeatured : ""}`} aria-label={`${plan.name} plan`}>
      <div className={styles.cardTop}>
        <h3 className={styles.cardName}>{plan.name}</h3>
        {plan.is_current ? (
          <span className={`${styles.badge} ${styles.badgeCurrent}`}>Your plan</span>
        ) : (
          plan.highlight_label && <span className={styles.badge}>{plan.highlight_label}</span>
        )}
      </div>
      <p className={styles.cardDesc}>{plan.description}</p>

      <div>
        {price === null ? (
          <div className={styles.price}>
            <span className={styles.priceUnit}>Not sold {period === "ANNUAL" ? "yearly" : "monthly"}</span>
          </div>
        ) : (
          <div className={styles.price}>
            <span className={styles.priceValue}>{free ? "Free" : formatBdt(price)}</span>
            {!free && <span className={styles.priceUnit}>/ {period === "ANNUAL" ? "year" : "month"}</span>}
          </div>
        )}
        <p className={styles.priceNote}>
          {period === "ANNUAL" && price
            ? `${formatBdt(Math.round(price / 12))} a month${saving ? `, ${saving}% less than monthly` : ""}`
            : plan.setup_fee_bdt > 0
              ? `Plus ${formatBdt(plan.setup_fee_bdt)} one-time setup`
              : ""}
        </p>
      </div>

      {canPay && price !== null && !free && (
        <button
          type="button"
          className={`${plan.is_current || !featured ? ws.quietButton : ws.inkButton} ${styles.cta}`}
          disabled={busy}
          onClick={() => onChoose(plan, period)}
        >
          {busy ? "Making invoice…" : ctaLabel}
        </button>
      )}

      {free && !plan.is_current && <p className={styles.footnote}>Free plans can&apos;t be bought. Contact support to switch to it.</p>}

      {warnings.map((w) => (
        <div key={w} className={styles.overLimit}>
          <AlertTriangle size={14} /> {w}
        </div>
      ))}

      <ul className={styles.limits}>
        {plan.limits.map((limit) => {
          const off = limit.value === false || limit.value === 0;
          return (
            <li key={limit.id} className={`${styles.limit} ${off ? styles.limitOff : ""}`}>
              {off ? <Minus size={15} /> : <Check size={15} />}
              {limitText(limit)}
            </li>
          );
        })}
      </ul>
    </article>
  );
}
