"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, Copy, Search, X } from "lucide-react";
import { api, formatBdt, formatDateTime } from "./api";
import type { PaymentLinkView } from "./PaymentLinksPanel";
import styles from "./PaymentsPage.module.css";
import ws from "@/components/ui/WorkScreen/WorkScreen.module.css";

/** An order as the picker lists it (GET /api/v1/orders). */
interface OrderOption {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  grand_total: number;
  customer_name?: string;
  created_at: string;
}

/** Orders a link can't be made for: the server refuses these too (PaymentLinkService.create). */
const CLOSED_ORDER_STATUSES = new Set(["CANCELLED", "RETURNED", "REFUNDED"]);
const SETTLED_PAYMENT_STATUSES = new Set(["PAID", "REFUNDED", "PARTIALLY_REFUNDED"]);
const isPayable = (order: OrderOption) => !CLOSED_ORDER_STATUSES.has(order.status) && !SETTLED_PAYMENT_STATUSES.has(order.payment_status);

export function linkUrl(link: PaymentLinkView): string {
  return link.url ?? (typeof window === "undefined" ? link.path : `${window.location.origin}${link.path}`);
}

/**
 * Side panel for making a payment link: one search box that lists matching unpaid orders, the amount as
 * "everything still due" or a custom figure, and an optional note. The server decides the final amount.
 */
export function CreatePaymentLinkPanel({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> | void }) {
  const [search, setSearch] = useState("");
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [ordersState, setOrdersState] = useState<"loading" | "ready" | "failed">("loading");
  const [chosen, setChosen] = useState<OrderOption | null>(null);
  const [amountMode, setAmountMode] = useState<"due" | "custom">("due");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<PaymentLinkView | null>(null);
  const [copied, setCopied] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Recent payable orders; typing searches by order number, customer name or phone
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setOrdersState("loading");
      const query = new URLSearchParams({ limit: "100" });
      if (search.trim()) query.set("search", search.trim());
      const result = await api<OrderOption[]>(`/api/v1/orders?${query.toString()}`);
      if (cancelled) return;
      if (result.ok && Array.isArray(result.data)) {
        setOrders(result.data.filter(isPayable));
        setOrdersState("ready");
      } else {
        setOrdersState("failed");
      }
    }, search ? 300 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!chosen) {
      setError("Choose the order this link is for.");
      return;
    }
    const parsedAmount = amountMode === "custom" ? Number(amount) : undefined;
    if (amountMode === "custom" && !(parsedAmount !== undefined && parsedAmount > 0)) {
      setError("Enter an amount above zero, or choose “Everything still due”.");
      return;
    }
    setBusy(true);
    const result = await api<{ link: PaymentLinkView }>("/api/v1/payments/links", {
      method: "POST",
      json: { order_id: chosen.id, ...(parsedAmount !== undefined ? { amount: parsedAmount } : {}), ...(note.trim() ? { note: note.trim() } : {}) },
    });
    setBusy(false);
    if (result.ok && result.data) {
      setCreated(result.data.link);
      await onCreated();
    } else {
      setError(result.error?.message ?? "Could not create the link.");
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(linkUrl(created));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy. Select the link and copy it by hand.");
    }
  };

  const startAnother = () => {
    setCreated(null);
    setChosen(null);
    setAmountMode("due");
    setAmount("");
    setNote("");
    setSearch("");
    setError(null);
    searchRef.current?.focus();
  };

  // Keep the chosen order visible while a new search loads
  const visibleOrders = chosen && !orders.some((o) => o.id === chosen.id) ? [chosen, ...orders] : orders;

  return (
    <>
      <div className={ws.scrim} onClick={onClose} aria-hidden="true" />
      <form className={ws.panel} role="dialog" aria-modal="true" aria-labelledby="create-link-title" onSubmit={submit}>
        <div className={ws.panelHead}>
          <div>
            <h2 id="create-link-title" className={ws.sectionTitle}>
              New payment link
            </h2>
            <p className={ws.sectionHint}>Send it on Messenger, WhatsApp or SMS. Links expire after 3 days.</p>
          </div>
          <button type="button" className={ws.iconButton} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className={ws.panelBody}>
          {created ? (
            <div className={styles.success} role="status">
              <p className={styles.successTitle}>
                <CheckCircle2 size={18} /> {formatBdt(created.amount)} link ready for {created.order_number}
              </p>
              <div className={styles.linkRow}>
                <span className={styles.linkBox} title={linkUrl(created)}>
                  {linkUrl(created)}
                </span>
                <button type="button" className={ws.inkButtonSm} onClick={() => void copy()}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <span className={ws.fieldHint}>Expires {formatDateTime(created.expires_at)}</span>
            </div>
          ) : (
            <>
              <div className={ws.field}>
                <label className={ws.fieldLabel} htmlFor="link-order-search">
                  Order
                </label>
                <div className={ws.searchWrap}>
                  <Search size={16} />
                  <input
                    id="link-order-search"
                    ref={searchRef}
                    className={ws.textInput}
                    placeholder="Order number, customer name or phone"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className={styles.orderList} role="listbox" aria-label="Unpaid orders">
                  {ordersState === "failed" ? (
                    <div className={styles.listState}>Could not load orders.</div>
                  ) : ordersState === "loading" && visibleOrders.length === 0 ? (
                    <div className={styles.listState}>Loading orders…</div>
                  ) : visibleOrders.length === 0 ? (
                    <div className={styles.listState}>{search.trim() ? "No unpaid order matches." : "No orders waiting for payment."}</div>
                  ) : (
                    visibleOrders.map((order) => (
                      <button
                        key={order.id}
                        type="button"
                        role="option"
                        aria-selected={chosen?.id === order.id}
                        className={`${styles.orderOption} ${chosen?.id === order.id ? styles.orderOptionActive : ""}`}
                        onClick={() => setChosen(order)}
                      >
                        <span>
                          <span className={ws.primaryText}>{order.order_number}</span>
                          <span className={styles.optionMeta}>
                            {order.customer_name?.trim() || "No customer name"}
                          </span>
                        </span>
                        <span className={ws.primaryText}>{formatBdt(order.grand_total)}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className={ws.field}>
                <span className={ws.fieldLabel}>Amount</span>
                <div className={ws.chips} role="radiogroup" aria-label="Amount">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={amountMode === "due"}
                    className={`${ws.chip} ${amountMode === "due" ? ws.chipActive : ""}`}
                    onClick={() => setAmountMode("due")}
                  >
                    Everything still due
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={amountMode === "custom"}
                    className={`${ws.chip} ${amountMode === "custom" ? ws.chipActive : ""}`}
                    onClick={() => setAmountMode("custom")}
                  >
                    Custom amount
                  </button>
                </div>
                {amountMode === "custom" ? (
                  <input
                    className={ws.textInput}
                    inputMode="decimal"
                    placeholder="e.g. 120 for the delivery charge"
                    aria-label="Custom amount in taka"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    autoFocus
                  />
                ) : (
                  <span className={ws.fieldHint}>
                    {chosen ? `Order total ${formatBdt(chosen.grand_total)}; anything already paid is taken off.` : "Worked out from the order when the link is made."}
                  </span>
                )}
              </div>

              <div className={ws.field}>
                <label className={ws.fieldLabel} htmlFor="link-note">
                  Note for the customer <span className={ws.fieldHint}>(optional)</span>
                </label>
                <input
                  id="link-note"
                  className={ws.textInput}
                  placeholder="e.g. Advance delivery charge"
                  maxLength={140}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </>
          )}
          {error && (
            <p className={ws.errorText} role="alert">
              {error}
            </p>
          )}
        </div>

        <div className={ws.panelFoot}>
          {created ? (
            <>
              <button type="button" className={ws.textButton} onClick={startAnother}>
                Make another
              </button>
              <button type="button" className={ws.inkButton} onClick={onClose}>
                Done
              </button>
            </>
          ) : (
            <>
              <button type="button" className={ws.textButton} onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className={ws.inkButton} disabled={busy || !chosen}>
                {busy ? "Creating…" : "Create link"}
              </button>
            </>
          )}
        </div>
      </form>
    </>
  );
}
