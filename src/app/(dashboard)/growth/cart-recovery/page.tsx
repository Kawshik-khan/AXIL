"use client";

import React, { useState } from "react";
import { BadgeCheck, CheckCircle2, Clock, MessageSquare, PackageCheck, PlugZap, RefreshCw, ShieldOff } from "lucide-react";
import { useSection } from "@/components/dashboard/dashboard-data";
import { SectionState } from "@/components/dashboard/SectionState";
import { api } from "@/components/payments/api";
import { EmptyState } from "@/components/ui/States/States";
import { PERMISSIONS } from "@/lib/permissions";
import { FeedbackToast, GrowthShell, Panel, type Feedback } from "../_components/GrowthShell";
import { formatBdt, formatCount, initials } from "../_components/growth-format";
import styles from "../_components/Growth.module.css";

type Stage = "PENDING" | "MESSAGED" | "RECOVERED" | "EXPIRED";

interface AbandonedCart {
  id: string;
  customer?: { first_name: string; last_name?: string; phone: string };
  cart_items: Array<{ title: string; quantity: number }>;
  formatted_total: string;
  time_ago: string;
  recovery_stage: Stage;
}

interface CartOverview {
  total_recovered_revenue_bdt: number;
  total_abandoned_revenue_bdt: number;
  cart_recovery_rate_pct: number;
  active_abandoned_carts_count: number;
}

interface NudgeResult {
  success: boolean;
  error?: string;
}

type Filter = "ALL" | "OPEN" | "MESSAGED" | "RECOVERED";

const FILTERS: Array<{ value: Filter; label: string; match: (s: Stage) => boolean }> = [
  { value: "ALL", label: "All", match: () => true },
  { value: "OPEN", label: "Not messaged", match: (s) => s === "PENDING" },
  { value: "MESSAGED", label: "Messaged", match: (s) => s === "MESSAGED" },
  { value: "RECOVERED", label: "Recovered", match: (s) => s === "RECOVERED" },
];

const STAGE_CHIP: Record<Stage, { label: string; className: string }> = {
  PENDING: { label: "Not messaged", className: styles.chipWarn },
  MESSAGED: { label: "Messaged", className: styles.chipLilac },
  RECOVERED: { label: "Recovered", className: styles.chipOk },
  EXPIRED: { label: "Expired", className: "" },
};

/** Abandoned carts and WhatsApp nudges (moved here from the Marketing page, 2026-11-26). */
export default function CartRecoveryPage() {
  const overview = useSection<CartOverview>("/api/v1/marketing/overview");
  const carts = useSection<{ carts: AbandonedCart[] }>("/api/v1/marketing/abandoned-carts");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [nudgingId, setNudgingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const reloadAll = () => {
    overview.reload();
    carts.reload();
  };
  const busy = overview.loading || carts.loading;
  const o = overview.data;
  const list = carts.data?.carts ?? [];
  const shown = list.filter((c) => FILTERS.find((f) => f.value === filter)!.match(c.recovery_stage));

  const nudge = async (cart: AbandonedCart) => {
    setNudgingId(cart.id);
    setFeedback(null);
    const res = await api<{ result: NudgeResult }>(`/api/v1/marketing/abandoned-carts/${cart.id}/nudge`, { method: "POST", json: {} });
    setNudgingId(null);
    const who = cart.customer?.first_name ?? "the customer";
    // The route answers 200 with success: false when nothing was sent (opt-out, cap, no connected channel)
    if (res.ok && res.data?.result?.success) {
      setFeedback({ tone: "ok", text: `Nudge sent to ${who} on WhatsApp.` });
      reloadAll();
    } else {
      setFeedback({ tone: "error", text: `Not sent to ${who}: ${res.data?.result?.error ?? res.error?.message ?? "the nudge could not be sent."}` });
    }
  };

  let leadNote = "Could not load";
  if (o) leadNote = "From carts credited to a verified order";
  else if (overview.status === 403) leadNote = `Needs ${PERMISSIONS.MARKETING_READ}`;
  else if (overview.loading) leadNote = "Loading";

  return (
    <GrowthShell
      active="/growth/cart-recovery"
      title="Cart recovery"
      subtitle="Carts left without checking out, and the WhatsApp nudges that bring them back."
      counts={{ "/growth/cart-recovery": o?.active_abandoned_carts_count ?? null }}
      actions={
        <button type="button" className={styles.ghost} onClick={reloadAll} disabled={busy}>
          <RefreshCw size={14} className={busy ? styles.spin : undefined} /> Refresh
        </button>
      }
    >
      <FeedbackToast feedback={feedback} onClose={() => setFeedback(null)} />

      <section className={styles.kpiRow} aria-label="Key figures">
        <div className={`${styles.card} ${styles.kpi} ${styles.kpiLead}`} aria-busy={overview.loading}>
          <span className={styles.kpiLabel}>Recovered revenue</span>
          <span>
            <span className={styles.kpiValue}>{o ? formatBdt(o.total_recovered_revenue_bdt) : "—"}</span>
            <span className={styles.note}>{leadNote}</span>
          </span>
        </div>
        <Figure label="Recovery rate" value={o ? `${o.cart_recovery_rate_pct}%` : "—"} note="Of abandoned value" meter={o?.cart_recovery_rate_pct} />
        <Figure label="Open carts" value={o ? formatCount(o.active_abandoned_carts_count) : "—"} note="Not recovered yet" />
        <Figure label="Abandoned value" value={o ? formatBdt(o.total_abandoned_revenue_bdt) : "—"} note="All carts left behind" />
      </section>

      <div className={styles.split}>
        <Panel
          title="Abandoned carts"
          note={carts.data ? `${list.length.toLocaleString()} carts, newest first` : undefined}
          actions={
            <div className={styles.filters} role="group" aria-label="Show carts">
              {FILTERS.map((f) => (
                <button key={f.value} type="button" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
                  {f.label}
                  <span className={styles.tabCount}>{list.filter((c) => f.match(c.recovery_stage)).length}</span>
                </button>
              ))}
            </div>
          }
        >
          <SectionState section={carts} resource="abandoned carts" permission={PERMISSIONS.MARKETING_READ}>
            {() =>
              list.length === 0 ? (
                <EmptyState inline title="No abandoned carts" description="Recent carts have either checked out or been recovered." />
              ) : shown.length === 0 ? (
                <p className={styles.empty}>No carts in this view.</p>
              ) : (
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>In the cart</th>
                        <th className={styles.right}>Total</th>
                        <th>Left</th>
                        <th>Status</th>
                        <th className={styles.right}>
                          <span className={styles.srOnly}>Action</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((cart) => (
                        <CartRow key={cart.id} cart={cart} nudging={nudgingId === cart.id} disabled={nudgingId !== null} onNudge={() => void nudge(cart)} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </SectionState>
        </Panel>

        <Panel lilac title="Before a nudge goes out" note="Every nudge is checked first. If a check fails, nothing is sent and you see why.">
          <ul className={styles.rules}>
            <li>
              <ShieldOff size={16} />
              <span>
                <strong>Customer hasn&apos;t opted out</strong>
                Anyone who opted out of WhatsApp marketing, or is on the do-not-contact list, is skipped.
              </span>
            </li>
            <li>
              <PackageCheck size={16} />
              <span>
                <strong>They haven&apos;t ordered since</strong>
                A cart followed by an order is left alone.
              </span>
            </li>
            <li>
              <Clock size={16} />
              <span>
                <strong>Not messaged too often</strong>
                Daily and weekly limits, and a cool-down between messages.
              </span>
            </li>
            <li>
              <BadgeCheck size={16} />
              <span>
                <strong>Prices and stock are current</strong>
                The message quotes live catalogue prices for items in stock.
              </span>
            </li>
            <li>
              <PlugZap size={16} />
              <span>
                <strong>WhatsApp is connected</strong>
                Without a connected WhatsApp number, nothing can be sent.
              </span>
            </li>
          </ul>
        </Panel>
      </div>
    </GrowthShell>
  );
}

function Figure({ label, value, note, meter }: { label: string; value: string; note: string; meter?: number }) {
  return (
    <div className={`${styles.card} ${styles.kpi}`}>
      <span className={styles.kpiLabel}>{label}</span>
      <span>
        <span className={styles.kpiValue}>{value}</span>
        <span className={styles.note}>{note}</span>
        {typeof meter === "number" && (
          <span className={styles.track} aria-hidden style={{ display: "block", marginTop: "var(--space-8)", height: 6 }}>
            <span className={styles.trackFill} style={{ width: `${Math.min(100, meter)}%`, display: "block" }} />
          </span>
        )}
      </span>
    </div>
  );
}

function CartRow({ cart, nudging, disabled, onNudge }: { cart: AbandonedCart; nudging: boolean; disabled: boolean; onNudge: () => void }) {
  const name = cart.customer ? `${cart.customer.first_name} ${cart.customer.last_name ?? ""}`.trim() : "Guest customer";
  const chip = STAGE_CHIP[cart.recovery_stage] ?? STAGE_CHIP.PENDING;
  const items = cart.cart_items ?? [];
  return (
    <tr>
      <td>
        <span className={styles.person}>
          <span className={styles.avatar} aria-hidden>
            {initials(name)}
          </span>
          <span>
            <span className={styles.cellMain}>{name}</span>
            <span className={styles.cellMuted}>{cart.customer?.phone ?? "No phone"}</span>
          </span>
        </span>
      </td>
      <td>
        <span className={styles.items}>
          {items.slice(0, 2).map((item, i) => (
            <span key={i}>
              {item.title} <span className={styles.cellMuted} style={{ display: "inline" }}>× {item.quantity}</span>
            </span>
          ))}
          {items.length > 2 && <span className={styles.cellMuted}>+{items.length - 2} more</span>}
        </span>
      </td>
      <td className={`${styles.right} ${styles.cellTotal}`}>{cart.formatted_total}</td>
      <td>
        <span className={styles.cellMuted}>{cart.time_ago}</span>
      </td>
      <td>
        <span className={`${styles.chip} ${chip.className}`}>{chip.label}</span>
      </td>
      <td className={styles.right}>
        {cart.recovery_stage === "RECOVERED" ? (
          <span className={`${styles.chip} ${styles.chipOk}`}>
            <CheckCircle2 size={12} /> Ordered
          </span>
        ) : cart.recovery_stage === "EXPIRED" ? null : (
          <button
            type="button"
            className={`${cart.recovery_stage === "MESSAGED" ? styles.secondary : styles.primary} ${styles.small}`}
            onClick={onNudge}
            disabled={disabled}
          >
            <MessageSquare size={13} /> {nudging ? "Sending…" : cart.recovery_stage === "MESSAGED" ? "Nudge again" : "Send nudge"}
          </button>
        )}
      </td>
    </tr>
  );
}
