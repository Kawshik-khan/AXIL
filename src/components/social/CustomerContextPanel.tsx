"use client";

import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api, type ApiFailure } from "@/components/payments/api";
import type { Order } from "@/types/commerce";
import { ActionNotices, AnswerSwitch, HandlingSelects } from "./ConversationThread";
import { HandoffContextCard, draftOrderOf } from "./HandoffContextCard";
import { customerName, dayLabel, sentenceCase, takaOf } from "./inbox-view";
import type { Inbox } from "./useInbox";
import styles from "./Inbox.module.css";

const CLOSED_WELL = new Set(["DELIVERED"]);
const CLOSED_BADLY = new Set(["CANCELLED", "RETURNED", "REFUNDED"]);

interface CustomerContextPanelProps {
  inbox: Inbox;
  onClose: () => void;
  onCreateOrder: () => void;
  onReviewDraft: () => void;
}

/** The rail: the handoff brief, an order the agent prepared, the customer and their last orders. */
export const CustomerContextPanel: React.FC<CustomerContextPanelProps> = ({ inbox, onClose, onCreateOrder, onReviewDraft }) => {
  const c = inbox.active;
  const customerId = c?.customer?.id;
  // A new order from this chat raises the count, and the list is read again
  const orderCount = c?.customer?.total_orders;
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [ordersError, setOrdersError] = useState<ApiFailure | null>(null);
  const [tag, setTag] = useState("");
  useEffect(() => setTag(""), [customerId]);

  useEffect(() => {
    setOrders(null);
    setOrdersError(null);
    if (!customerId) return;
    let cancelled = false;
    void api<Order[]>(`/api/v1/orders?customer_id=${encodeURIComponent(customerId)}&limit=5`).then((result) => {
      if (cancelled) return;
      if (result.ok) setOrders(result.data ?? []);
      else setOrdersError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [customerId, orderCount]);

  if (!c) return null;

  const draft = draftOrderOf(c)?.draft;
  const address = c.customer?.addresses?.find((a) => a.is_default) ?? c.customer?.addresses?.[0];
  const submitTag = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = tag.trim();
    if (value && (await inbox.addTag(value))) setTag("");
  };

  return (
    <aside
      className={`${styles.rail} ${styles.scroll}`}
      aria-label="Customer details"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className={styles.railHead}>
        <h2>{customerName(c)}</h2>
        <button type="button" className={`${styles.iconButton} ${styles.iconButtonLarge}`} onClick={onClose} aria-label="Close details">
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      {/* Over the chat, the rail covers the chat's own notices */}
      <div className={styles.railNotices}>
        <ActionNotices inbox={inbox} />
      </div>

      {/* On a phone the chat's header has no room for these */}
      <section className={`${styles.railCard} ${styles.railPhone}`} aria-label="Handling">
        <h3>Handling</h3>
        <AnswerSwitch inbox={inbox} />
        <div className={`${styles.pair} ${styles.railSelects}`}>
          <HandlingSelects inbox={inbox} idPrefix="rail" labels />
        </div>
      </section>

      <HandoffContextCard conversation={c} now={inbox.now} />

      {draft && (
        <section className={styles.railCard} aria-label="Order draft">
          <div className={styles.cardTop}>
            <h3>Order draft</h3>
            <span className={`${styles.chip} ${styles.chipAgent}`}>✦ Prepared</span>
          </div>
          <div className={styles.sums}>
            {draft.items.map((item) => (
              <div key={item.variant_id} className={styles.sumRow}>
                <span>
                  {item.quantity} × {item.product_name}
                </span>
                <span>{takaOf(item.line_total)}</span>
              </div>
            ))}
            <div className={`${styles.sumRow} ${styles.sumMuted}`}>
              <span>Delivery, {draft.delivery_district}</span>
              <span>{takaOf(draft.delivery_fee)}</span>
            </div>
            <div className={`${styles.sumRow} ${styles.sumTotal}`}>
              <span>Total, {draft.payment_method === "COD" ? "cash on delivery" : sentenceCase(draft.payment_method)}</span>
              <span>{takaOf(draft.grand_total)}</span>
            </div>
          </div>
          <button type="button" className={styles.ink} onClick={onReviewDraft}>
            Review and confirm
          </button>
        </section>
      )}

      <section className={styles.railCard} aria-label="Customer">
        <h3>Customer</h3>
        <div className={styles.facts}>
          <span>{c.customer?.phone || "No phone on record"}</span>
          {c.customer?.email && <span>{c.customer.email}</span>}
          {address && <span>{[address.area, address.district].filter(Boolean).join(", ")}</span>}
        </div>
        {c.customer && (
          <div className={styles.pair}>
            <div className={styles.metric}>
              <b>{c.customer.total_orders ?? 0}</b>
              <span>Orders</span>
            </div>
            <div className={styles.metric}>
              <b>{takaOf(c.customer.total_spent ?? 0)}</b>
              <span>Spent</span>
            </div>
          </div>
        )}
        {c.tags.length > 0 && (
          <div className={styles.tags}>
            {c.tags.map((t) => (
              <span key={t}>{sentenceCase(t)}</span>
            ))}
          </div>
        )}
        <form className={styles.tagForm} onSubmit={(e) => void submitTag(e)}>
          <label className={styles.srOnly} htmlFor="inbox-tag">
            New tag
          </label>
          <input id="inbox-tag" placeholder="Add a tag" value={tag} maxLength={40} onChange={(e) => setTag(e.target.value)} />
          <button type="submit" className={styles.soft} disabled={!tag.trim() || inbox.busy === "tag"}>
            Add
          </button>
        </form>
        <div className={styles.pair}>
          <button type="button" className={styles.soft} onClick={onCreateOrder}>
            Create order
          </button>
          <button type="button" className={styles.soft} onClick={() => void inbox.saveLead()} disabled={!c.customer || inbox.busy === "lead"}>
            Save as lead
          </button>
        </div>
      </section>

      <section className={styles.railCard} aria-label="Recent orders">
        <h3>Recent orders</h3>
        {ordersError ? (
          <p role="alert">
            Orders could not be loaded: {ordersError.message} {ordersError.request_id && <code>{ordersError.request_id}</code>}
          </p>
        ) : !customerId || orders?.length === 0 ? (
          <p>No orders found.</p>
        ) : !orders ? (
          <p>Loading orders.</p>
        ) : (
          orders.map((order) => (
            <div key={order.id} className={styles.order}>
              <span>
                <b>{order.order_number}</b>
                {takaOf(order.grand_total)}, {dayLabel(order.created_at, inbox.now)}
              </span>
              <span className={CLOSED_WELL.has(order.status) ? styles.orderDone : CLOSED_BADLY.has(order.status) ? undefined : styles.orderOpen}>
                {sentenceCase(order.status)}
              </span>
            </div>
          ))
        )}
      </section>
    </aside>
  );
};
