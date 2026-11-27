"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, MessageCircle, Phone, Plus } from "lucide-react";
import { ErrorState, LoadingSkeleton, PermissionDenied } from "@/components/ui/States/States";
import type { Customer, CustomerAddress, Order, OrderStatus, PaymentMethod } from "@/types/commerce";
import { customerSegment } from "@/lib/customer-segments";
import { SEGMENT_CLASS, TINT_CLASS } from "../CustomerTable";
import { SEGMENT_LABELS, displayName, formatTaka, initialsOf, monthYear, phoneDigits, relativeTime, tintOf } from "../customer-display";
import listStyles from "../customers.module.css";
import styles from "./profile.module.css";

interface CustomerDetails {
  customer: Customer;
  addresses?: CustomerAddress[];
  /** null when the role can't read orders */
  orders: Order[] | null;
}

type LoadError = { message: string; requestId?: string; status?: number };

const PAYMENT_LABEL: Record<PaymentMethod, string> = { COD: "Cash on delivery", BKASH: "bKash", NAGAD: "Nagad", ROCKET: "Rocket", CARD: "Card" };
const PAYMENT_DOT: Record<PaymentMethod, string> = { COD: styles.dotNeutral, BKASH: styles.dotBkash, NAGAD: styles.dotNagad, ROCKET: styles.dotRocket, CARD: styles.dotNeutral };

function statusClass(status: OrderStatus): string {
  if (status === "DELIVERED") return styles.ok;
  if (status === "SHIPPED" || status === "READY_TO_SHIP") return styles.ship;
  if (status === "CANCELLED" || status === "RETURNED" || status === "REFUNDED") return styles.bad;
  if (status === "RETURN_REQUESTED") return styles.warn;
  return styles.neutral;
}

const statusLabel = (status: string) => status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");

function addressText(a: CustomerAddress): { line: string; sub: string } {
  return {
    line: [a.address_line_1, a.address_line_2, a.area].filter(Boolean).join(", "),
    sub: [a.upazila, a.district, a.division, a.postal_code].filter(Boolean).join(", "),
  };
}

export default function CustomerProfilePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [data, setData] = useState<CustomerDetails | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/customers/${encodeURIComponent(id)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ message: json?.error?.message || "This customer could not be loaded.", requestId: json?.error?.request_id, status: res.status });
        return;
      }
      setData(json.data as CustomerDetails);
    } catch {
      setError({ message: "Could not reach the server." });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (error?.status === 403) return <PermissionDenied resource="customers" requiredPermission="customers.read" />;

  const back = (
    <Link href="/customers" className={styles.back}>
      <ArrowLeft size={15} /> Customers
    </Link>
  );

  if (loading && !data) {
    return (
      <div className={styles.page}>
        {back}
        <LoadingSkeleton lines={8} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={styles.page}>
        {back}
        <ErrorState
          message={error?.status === 404 ? "This customer doesn't exist or was erased." : error?.message ?? "This customer could not be loaded."}
          requestId={error?.requestId}
          onRetry={load}
        />
      </div>
    );
  }

  const { customer, orders } = data;
  const addresses = data.addresses ?? [];
  const name = displayName(customer);
  const segment = customerSegment(customer);
  const digits = phoneDigits(customer.phone);
  const orderCount = customer.total_orders ?? 0;
  const spent = customer.total_spent ?? 0;
  const since = monthYear(customer.created_at);
  const delivered = orders?.filter((o) => o.status === "DELIVERED").length ?? 0;
  const returned = orders?.filter((o) => o.status === "RETURNED" || o.status === "REFUNDED").length ?? 0;
  const finished = delivered + returned;

  return (
    <div className={styles.page}>
      {back}

      <header className={styles.header}>
        <div className={styles.identity}>
          <span className={`${listStyles.avatar} ${styles.avatarXl} ${TINT_CLASS[tintOf(customer.id)]}`} aria-hidden="true">
            {initialsOf(name)}
          </span>
          <div>
            <h1 className={styles.title}>{name}</h1>
            <div className={styles.meta}>
              <span className={`${listStyles.segment} ${SEGMENT_CLASS[segment]}`}>{SEGMENT_LABELS[segment]}</span>
              {customer.status === "BLACKLISTED" && <span className={`${styles.pill} ${styles.bad}`}>Blocked</span>}
              {since && <span>Customer since {since}</span>}
            </div>
          </div>
        </div>
        <div className={styles.actions}>
          {digits && (
            <>
              <a href={`tel:+${digits}`} className={styles.ghost}>
                <Phone size={15} /> Call
              </a>
              <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer" className={styles.ghost}>
                <MessageCircle size={15} /> WhatsApp
              </a>
            </>
          )}
          <Link href="/orders" className={styles.primary}>
            <Plus size={16} /> New order
          </Link>
        </div>
      </header>

      <section className={styles.kpis} aria-label="Key figures">
        <div className={`${styles.kpi} ${styles.kpiLead}`}>
          <span className={styles.kpiLabel}>Lifetime value</span>
          <span>
            <span className={styles.kpiValue}>{formatTaka(spent)}</span>
            <span className={styles.note}>
              {orderCount} {orderCount === 1 ? "order" : "orders"}
              {since ? ` since ${since}` : ""}
            </span>
          </span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Average order</span>
          <span>
            <span className={styles.kpiValue}>{orderCount > 0 ? formatTaka(spent / orderCount) : "—"}</span>
            <span className={styles.note}>Lifetime value ÷ orders</span>
          </span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Delivered</span>
          <span>
            <span className={styles.kpiValue}>{orders === null ? "—" : finished > 0 ? `${delivered} of ${finished}` : "—"}</span>
            <span className={styles.note}>
              {orders === null ? "Your role can't view orders" : returned > 0 ? `${returned} returned or refunded` : finished > 0 ? "None returned" : "No finished orders yet"}
            </span>
          </span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Last order</span>
          <span>
            <span className={styles.kpiValue}>{relativeTime(customer.last_order_at) ?? "—"}</span>
            <span className={styles.note}>{customer.last_order_at ? new Date(customer.last_order_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "No orders yet"}</span>
          </span>
        </div>
      </section>

      <div className={styles.split}>
        <section className={styles.card} aria-label="Orders">
          <div className={styles.cardHead}>
            <div>
              <h2 className={styles.cardTitle}>Orders</h2>
              <div className={styles.note}>{orders === null ? "Needs the orders.read permission" : `Newest first · ${orders.length} shown`}</div>
            </div>
            <Link href="/orders" className={styles.linkPill}>
              All orders →
            </Link>
          </div>
          {orders === null ? (
            <p className={styles.empty}>Your role can&apos;t view orders.</p>
          ) : orders.length === 0 ? (
            <p className={styles.empty}>No orders yet.</p>
          ) : (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Date</th>
                    <th>Items</th>
                    <th>Payment</th>
                    <th>Status</th>
                    <th className={styles.num}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td className={styles.strong}>{o.order_number}</td>
                      <td>{new Date(o.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}</td>
                      <td className={styles.items}>{o.items?.length ? o.items.map((i) => i.product_name_snapshot).join(", ") : "—"}</td>
                      <td>
                        <span className={styles.pay}>
                          <span className={`${styles.dot} ${PAYMENT_DOT[o.payment_method] ?? styles.dotNeutral}`} aria-hidden="true" />
                          {PAYMENT_LABEL[o.payment_method] ?? o.payment_method}
                        </span>
                      </td>
                      <td>
                        <span className={`${styles.pill} ${statusClass(o.status)}`}>{statusLabel(o.status)}</span>
                      </td>
                      <td className={`${styles.num} ${styles.strong}`}>{formatTaka(Number(o.grand_total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className={styles.side} aria-label="Contact and addresses">
          <div className={styles.sideSection}>
            <span className={styles.eyebrow}>Contact</span>
            <div className={styles.sideRow}>
              <span>Phone</span>
              <span className={styles.sideValue}>{customer.phone || "Not added"}</span>
            </div>
            <div className={styles.sideRow}>
              <span>Email</span>
              <span className={styles.sideValue}>{customer.email || "Not added"}</span>
            </div>
          </div>
          <div className={styles.sideSection}>
            <span className={styles.eyebrow}>Saved addresses</span>
            {addresses.length === 0 ? (
              <div className={styles.sideBlock}>No address saved.</div>
            ) : (
              addresses.map((a) => {
                const t = addressText(a);
                return (
                  <div key={a.id} className={styles.sideBlock}>
                    <span className={styles.sideValue}>{t.line}</span>
                    <span className={styles.sideSub}>
                      {t.sub}
                      {a.is_default ? " · Default" : ""}
                    </span>
                  </div>
                );
              })
            )}
          </div>
          {customer.notes && (
            <div className={styles.sideSection}>
              <span className={styles.eyebrow}>Notes</span>
              <div className={styles.sideBlock}>{customer.notes}</div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
