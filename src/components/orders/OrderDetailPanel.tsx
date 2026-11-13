"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, ShieldAlert, ShieldCheck, Truck } from "lucide-react";
import { api, formatBdt, formatDateTime } from "@/components/payments/api";
import { linkUrl } from "@/components/payments/CreatePaymentLinkPanel";
import type { PaymentLinkView } from "@/components/payments/PaymentLinksPanel";
import { METHOD_NAMES, MethodMark, timeAgo } from "@/components/payments/payment-ui";
import { ErrorState, LoadingSkeleton } from "@/components/ui/States/States";
import { SidePanel } from "@/components/ui/WorkScreen/SidePanel";
import type { OrderStatus } from "@/types/commerce";
import type { OrderRtoEvaluationRecord, RtoRiskTier } from "@/types/rto";
import { STATUS_LABELS } from "./OrdersList";
import ws from "@/components/ui/WorkScreen/WorkScreen.module.css";
import styles from "./OrderPanels.module.css";

interface DetailItem {
  id: string;
  quantity: number;
  unit_price?: number;
  line_total?: number;
  total_price?: number;
  product_name_snapshot?: string;
  title_snapshot?: string;
  name?: string;
  sku_snapshot?: string;
  variant_title_snapshot?: string;
}

interface AddressSnapshot {
  address_line_1?: string;
  district?: string;
  division?: string;
  phone?: string;
}

/** What GET /api/v1/orders/[id] returns under data.order (the fields this panel shows). */
interface OrderDetail {
  id: string;
  order_number: string;
  status: OrderStatus;
  payment_method: string;
  payment_status: string;
  subtotal?: number;
  shipping_total?: number;
  discount_total?: number;
  grand_total: number;
  created_at: string;
  customer_name?: string;
  customer_phone?: string;
  shipping_address_snapshot?: AddressSnapshot;
  delivery_address?: AddressSnapshot;
  items?: DetailItem[];
}

/** The usual path an order takes; any other status (cancelled, returned, refunded) is shown as closed. */
const PATH: OrderStatus[] = ["PENDING", "CONFIRMED", "PROCESSING", "READY_TO_SHIP", "SHIPPED", "DELIVERED"];

/** The next step staff take from each status, and whether cancelling is still allowed there. */
const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string; cancelReason?: string }>> = {
  PENDING: { to: "CONFIRMED", label: "Confirm order", cancelReason: "Cancelled by customer" },
  CONFIRMED: { to: "PROCESSING", label: "Start packing", cancelReason: "Customer cancelled before packing" },
  PROCESSING: { to: "READY_TO_SHIP", label: "Mark ready to ship" },
};

const RISK: Record<RtoRiskTier, { label: string; className: string; high: boolean }> = {
  VERY_LOW: { label: "Very low return risk", className: styles.riskLow, high: false },
  LOW: { label: "Low return risk", className: styles.riskLow, high: false },
  MEDIUM: { label: "Medium return risk", className: styles.riskMedium, high: false },
  HIGH: { label: "High return risk", className: styles.riskHigh, high: true },
  VERY_HIGH: { label: "Very high return risk", className: styles.riskHigh, high: true },
};

const ACTION_HINTS: Record<string, string> = {
  AUTO_CONFIRM: "Safe to confirm.",
  STANDARD_CONFIRM: "Confirm as usual.",
  WHATSAPP_CONFIRMATION: "Confirm with the customer on WhatsApp first.",
  REQUIRE_ADVANCE_COURIER_FEE: "Collect the delivery charge before you ship.",
  MANUAL_CALL_REQUIRED: "Call the customer to check the address first.",
  BLOCK_COD: "Ask for full payment in advance; don't send this as COD.",
};

/**
 * One order: where it is on its way, what to do next, return risk, customer, items and totals. Status changes go
 * through the transition API (the order lifecycle service decides what is allowed); nothing changes here first.
 */
export function OrderDetailPanel({ orderId, onClose, onChanged }: { orderId: string; onClose: () => void; onChanged: () => Promise<void> | void }) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [risk, setRisk] = useState<OrderRtoEvaluationRecord | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chargeLink, setChargeLink] = useState<PaymentLinkView | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const result = await api<{ order: OrderDetail }>(`/api/v1/orders/${encodeURIComponent(orderId)}`);
    if (result.ok && result.data?.order) {
      setOrder(result.data.order);
      setLoadError(null);
    } else {
      setLoadError(result.error?.message ?? "Could not load this order.");
    }
    const evaluation = await api<OrderRtoEvaluationRecord>(`/api/v1/rto/evaluate/${encodeURIComponent(orderId)}`);
    setRisk(evaluation.ok ? evaluation.data : null);
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const transition = async (to: OrderStatus, reason: string) => {
    setError(null);
    setBusy(to);
    const result = await api(`/api/v1/orders/${encodeURIComponent(orderId)}/transition`, { method: "POST", json: { status: to, reason } });
    setBusy(null);
    if (!result.ok) {
      setError(result.error?.message ?? "Could not update the order.");
      return;
    }
    await Promise.all([load(), onChanged()]);
  };

  // A real payment link (the Payments page flow): the delivery charge, or with `full` everything still due.
  // Staff send it to the customer themselves; nothing is sent from here.
  const requestAdvance = async (full: boolean) => {
    if (!order) return;
    setError(null);
    setBusy("charge");
    const result = await api<{ link: PaymentLinkView }>("/api/v1/payments/links", {
      method: "POST",
      json: full ? { order_id: order.id, note: "Advance payment" } : { order_id: order.id, amount: order.shipping_total, note: "Advance delivery charge" },
    });
    setBusy(null);
    if (result.ok && result.data) setChargeLink(result.data.link);
    else setError(result.error?.message ?? "Could not create the payment link.");
  };

  const copy = async () => {
    if (!chargeLink) return;
    try {
      await navigator.clipboard.writeText(linkUrl(chargeLink));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy. Select the link and copy it by hand.");
    }
  };

  const next = order ? NEXT[order.status] : undefined;
  const stepIndex = order ? PATH.indexOf(order.status) : -1;
  const address = order?.shipping_address_snapshot ?? order?.delivery_address;
  const tier = risk ? RISK[risk.risk_tier] : undefined;
  const openForAdvance = order?.payment_status !== "PAID" && (order?.status === "PENDING" || order?.status === "CONFIRMED");
  const advance =
    !risk || !order || !openForAdvance
      ? null
      : risk.recommended_action === "BLOCK_COD"
        ? { full: true, label: "Ask for full payment first" }
        : risk.recommended_action === "REQUIRE_ADVANCE_COURIER_FEE" && order.shipping_total
          ? { full: false, label: `Ask for the ${formatBdt(order.shipping_total)} delivery charge first` }
          : null;

  const footer = order ? (
    <>
      {next?.cancelReason && (
        <button type="button" className={ws.textButton} disabled={busy !== null} onClick={() => void transition("CANCELLED", next.cancelReason!)}>
          {busy === "CANCELLED" ? "Cancelling…" : "Cancel order"}
        </button>
      )}
      <span className={styles.footerSpacer} />
      {next ? (
        <button type="button" className={ws.inkButton} disabled={busy !== null} onClick={() => void transition(next.to, `${next.label} from the Orders page`)}>
          {busy === next.to ? "Saving…" : next.label}
        </button>
      ) : order.status === "READY_TO_SHIP" ? (
        <Link href="/shipments" className={ws.inkButton}>
          <Truck size={16} /> Book courier
        </Link>
      ) : (
        <button type="button" className={ws.inkButton} onClick={onClose}>
          Done
        </button>
      )}
    </>
  ) : undefined;

  return (
    <SidePanel
      wide
      onClose={onClose}
      title={order ? `Order ${order.order_number}` : "Order"}
      subtitle={order ? `Placed ${timeAgo(order.created_at)} · ${formatDateTime(order.created_at)}` : undefined}
      footer={footer}
    >
      {loadError ? (
        <ErrorState message={loadError} onRetry={() => void load()} inline />
      ) : !order ? (
        <LoadingSkeleton lines={6} inline />
      ) : (
        <>
          {stepIndex >= 0 ? (
            <ol className={styles.progress} aria-label={`Status: ${STATUS_LABELS[order.status]}`}>
              {PATH.map((step, i) => (
                <li
                  key={step}
                  className={`${styles.progressStep} ${i < stepIndex ? styles.progressDone : ""} ${i === stepIndex ? styles.progressCurrent : ""}`}
                  aria-current={i === stepIndex ? "step" : undefined}
                >
                  {STATUS_LABELS[step]}
                </li>
              ))}
            </ol>
          ) : (
            <div className={styles.closedBanner}>
              This order is <strong>{(STATUS_LABELS[order.status] ?? order.status).toLowerCase()}</strong>. Nothing more to do here.
            </div>
          )}

          {error && (
            <p className={ws.errorText} role="alert">
              {error}
            </p>
          )}

          {risk && tier && (
            <div className={`${styles.risk} ${tier.className}`}>
              <div className={styles.riskHead}>
                <span className={styles.inline}>
                  {tier.high ? <ShieldAlert size={16} /> : <ShieldCheck size={16} />} {tier.label}
                </span>
                <span className={styles.riskScore}>{risk.risk_score}/100</span>
              </div>
              <p className={styles.riskText}>
                {risk.factors?.summary_reason || ACTION_HINTS[risk.recommended_action] || ""}
              </p>
              {risk.advance_fee_paid ? (
                <p className={styles.riskText}>The advance delivery charge is paid.</p>
              ) : chargeLink ? (
                <div className={ws.field}>
                  <span className={ws.fieldHint}>
                    {formatBdt(chargeLink.amount)} link made. Send it to the customer yourself; nothing was sent automatically.
                  </span>
                  <div className={styles.inline}>
                    <span className={styles.linkLine} title={linkUrl(chargeLink)}>
                      {linkUrl(chargeLink)}
                    </span>
                    <button type="button" className={ws.inkButtonSm} onClick={() => void copy()}>
                      {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              ) : (
                advance && (
                  <div>
                    <button type="button" className={ws.quietButton} disabled={busy !== null} onClick={() => void requestAdvance(advance.full)}>
                      {busy === "charge" ? "Making link…" : advance.label}
                    </button>
                  </div>
                )
              )}
            </div>
          )}

          <div className={styles.blocks}>
            <div className={styles.block}>
              <span className={styles.blockTitle}>Customer</span>
              <span className={styles.blockStrong}>{order.customer_name || "Customer"}</span>
              <span>{order.customer_phone || address?.phone || "No phone number"}</span>
            </div>
            <div className={styles.block}>
              <span className={styles.blockTitle}>Deliver to</span>
              <span className={styles.blockStrong}>{address?.address_line_1 || "No street address"}</span>
              <span>{[address?.district, address?.division].filter(Boolean).join(", ") || "—"}</span>
            </div>
          </div>

          <section aria-label="Items">
            <span className={styles.groupTitle}>Items</span>
            <ul className={styles.items}>
              {(order.items ?? []).map((item) => {
                const title = item.product_name_snapshot || item.title_snapshot || item.name || "Item";
                const variant = item.variant_title_snapshot || item.sku_snapshot || "";
                const unit = item.unit_price ?? 0;
                const total = item.line_total ?? item.total_price ?? unit * (item.quantity || 1);
                return (
                  <li key={item.id} className={styles.item}>
                    <div>
                      <div className={ws.primaryText}>{title}</div>
                      <div className={styles.itemMeta}>
                        {variant ? `${variant} · ` : ""}
                        {item.quantity} × {formatBdt(unit)}
                      </div>
                    </div>
                    <div className={styles.itemTotal}>{formatBdt(total)}</div>
                  </li>
                );
              })}
            </ul>
          </section>

          <dl className={`${ws.summaryList} ${styles.preview}`}>
            <div>
              <dt>Subtotal</dt>
              <dd>{formatBdt(order.subtotal ?? 0)}</dd>
            </div>
            <div>
              <dt>Delivery</dt>
              <dd>{formatBdt(order.shipping_total ?? 0)}</dd>
            </div>
            {(order.discount_total ?? 0) > 0 && (
              <div>
                <dt>Discount</dt>
                <dd>−{formatBdt(order.discount_total ?? 0)}</dd>
              </div>
            )}
            <div className={ws.summaryTotal}>
              <dt>Total</dt>
              <dd>{formatBdt(order.grand_total)}</dd>
            </div>
            <div>
              <dt>Payment</dt>
              <dd className={styles.inline}>
                <MethodMark provider={order.payment_method} small />
                {METHOD_NAMES[order.payment_method] ?? order.payment_method} ·{" "}
                {order.payment_status === "PAID" ? "Paid" : order.payment_method === "COD" ? "Collect on delivery" : "Not paid yet"}
              </dd>
            </div>
          </dl>
        </>
      )}
    </SidePanel>
  );
}
