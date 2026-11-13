"use client";

import React from "react";
import { ChevronRight, Plus, Search } from "lucide-react";
import { formatBdt, formatDateTime } from "@/components/payments/api";
import { METHOD_NAMES, MethodMark, timeAgo } from "@/components/payments/payment-ui";
import { ErrorState } from "@/components/ui/States/States";
import type { Order, OrderStatus } from "@/types/commerce";
import ws from "@/components/ui/WorkScreen/WorkScreen.module.css";
import styles from "./OrdersList.module.css";

export interface OrderListItem extends Order {
  customer_name: string;
  customer_phone: string;
}

export type StatusCounts = Partial<Record<OrderStatus, number>>;

/** Staff-facing names: what the order needs, not the enum. */
export const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "To confirm",
  CONFIRMED: "Confirmed",
  PROCESSING: "Packing",
  READY_TO_SHIP: "Ready to ship",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  RETURN_REQUESTED: "Return requested",
  RETURNED: "Returned",
  REFUNDED: "Refunded",
};

const STATUS_TONE: Record<OrderStatus, string> = {
  PENDING: ws.statusWarn,
  CONFIRMED: ws.statusInfo,
  PROCESSING: ws.statusInfo,
  READY_TO_SHIP: ws.statusInfo,
  SHIPPED: ws.statusInfo,
  DELIVERED: ws.statusOk,
  CANCELLED: ws.statusMuted,
  RETURN_REQUESTED: ws.statusDanger,
  RETURNED: ws.statusDanger,
  REFUNDED: ws.statusMuted,
};

const PAYMENT_LABELS: Record<string, string> = {
  UNPAID: "Unpaid",
  PENDING: "Checking",
  AUTHORIZED: "Authorised",
  PAID: "Paid",
  FAILED: "Failed",
  PARTIALLY_REFUNDED: "Part refunded",
  REFUNDED: "Refunded",
};

export const STATUS_TABS: { key: "ALL" | OrderStatus; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "PENDING", label: "To confirm" },
  { key: "CONFIRMED", label: "Confirmed" },
  { key: "PROCESSING", label: "Packing" },
  { key: "READY_TO_SHIP", label: "Ready to ship" },
  { key: "SHIPPED", label: "Shipped" },
  { key: "DELIVERED", label: "Delivered" },
  { key: "CANCELLED", label: "Cancelled" },
];

function initials(name: string | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** The four queues staff work through, from real counts over every order. */
export function OrdersSummary({ counts }: { counts: StatusCounts | null }) {
  const n = (s: OrderStatus) => counts?.[s] ?? 0;
  const value = (v: number) => (counts ? v.toLocaleString("en-US") : "–");
  const stats = [
    { label: "To confirm", value: n("PENDING"), meta: "Call or message to confirm", live: n("PENDING") > 0 },
    { label: "To pack", value: n("CONFIRMED") + n("PROCESSING"), meta: `${value(n("PROCESSING"))} being packed` },
    { label: "Ready to ship", value: n("READY_TO_SHIP"), meta: "Waiting for courier pickup" },
    { label: "Out for delivery", value: n("SHIPPED"), meta: `${value(n("DELIVERED"))} delivered so far` },
  ];
  return (
    <section className={ws.stats} aria-label="Orders summary">
      {stats.map((stat) => (
        <div key={stat.label} className={ws.stat}>
          <span className={ws.statLabel}>
            {stat.live && <span className={ws.liveDot} aria-hidden="true" />}
            {stat.label}
          </span>
          <span className={ws.statValue}>{value(stat.value)}</span>
          <span className={ws.statMeta}>{counts ? stat.meta : "Counting…"}</span>
        </div>
      ))}
    </section>
  );
}

export function OrdersHeader({ onCreate }: { onCreate: () => void }) {
  return (
    <header className={ws.header}>
      <div>
        <h1 className={ws.title}>Orders</h1>
        <p className={ws.subtitle}>Every order from your website, Facebook, Instagram and WhatsApp, from confirmation to delivery.</p>
      </div>
      <button type="button" className={ws.inkButton} onClick={onCreate}>
        <Plus size={16} /> New order <span className={ws.kbd}>C</span>
      </button>
    </header>
  );
}

/** Searchable, status-filtered table of one page of orders. Opening a row shows the order's details. */
export function OrdersTable({
  orders,
  counts,
  isLoading,
  error,
  onRetry,
  totalCount,
  page,
  pageSize,
  onPageChange,
  statusFilter,
  onStatusChange,
  searchQuery,
  onSearch,
  onOpen,
  onCreate,
}: {
  orders: OrderListItem[];
  counts: StatusCounts | null;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  totalCount: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  statusFilter: string;
  onStatusChange: (status: string) => void;
  searchQuery: string;
  onSearch: (query: string) => void;
  onOpen: (orderId: string) => void;
  onCreate: () => void;
}) {
  const allCount = counts ? Object.values(counts).reduce<number>((sum, v) => sum + (v ?? 0), 0) : null;
  const tabCount = (key: string) => (key === "ALL" ? allCount : counts?.[key as OrderStatus] ?? 0);
  const from = page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, totalCount);
  const filtered = statusFilter !== "ALL" || searchQuery.trim() !== "";

  return (
    <section className={ws.section} aria-label="Order list">
      <div className={styles.toolbar}>
        <div className={`${ws.searchWrap} ${styles.search}`}>
          <Search size={16} />
          <input
            className={ws.textInput}
            placeholder="Order number, customer or phone"
            aria-label="Search orders"
            value={searchQuery}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
        <div className={styles.tabsScroll}>
          <div className={ws.tabs} role="tablist" aria-label="Filter by status">
            {STATUS_TABS.map((tab) => {
              const count = tabCount(tab.key);
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={statusFilter === tab.key}
                  className={`${ws.tab} ${statusFilter === tab.key ? ws.tabActive : ""}`}
                  onClick={() => onStatusChange(tab.key)}
                >
                  {tab.label}
                  {count !== null && <span className={ws.tabCount}>{count.toLocaleString("en-US")}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={onRetry} inline />
      ) : !isLoading && orders.length === 0 ? (
        <div className={ws.empty}>
          <p className={ws.emptyTitle}>{filtered ? "No orders match" : "No orders yet"}</p>
          <p className={ws.emptyText}>
            {filtered ? "Try another status or search." : "Orders from your shop and chats land here. You can also add one by hand."}
          </p>
          {!filtered && (
            <button type="button" className={`${ws.quietButton} ${styles.emptyAction}`} onClick={onCreate}>
              <Plus size={14} /> New order
            </button>
          )}
        </div>
      ) : (
        <div className={ws.tableScroll}>
          <table className={ws.table}>
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Payment</th>
                <th className={ws.numeric}>Total</th>
                <th>Placed</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody aria-busy={isLoading}>
              {isLoading
                ? Array.from({ length: 8 }, (_, i) => (
                    <tr key={i} className={styles.skeletonRow} aria-hidden="true">
                      {[70, 140, 90, 90, 60, 50, 10].map((w, j) => (
                        <td key={j}>
                          <span className={styles.skeleton} style={{ width: w }} />
                        </td>
                      ))}
                    </tr>
                  ))
                : orders.map((order) => (
                    <tr
                      key={order.id}
                      className={styles.row}
                      tabIndex={0}
                      onClick={() => onOpen(order.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpen(order.id);
                        }
                      }}
                      aria-label={`Open order ${order.order_number}`}
                    >
                      <td className={ws.orderNumber}>{order.order_number}</td>
                      <td>
                        <div className={styles.customer}>
                          <span className={styles.avatar} aria-hidden="true">
                            {initials(order.customer_name)}
                          </span>
                          <div>
                            <div className={ws.primaryText}>{order.customer_name || "Unknown customer"}</div>
                            <div className={ws.secondaryText}>{order.customer_phone}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`${ws.status} ${STATUS_TONE[order.status] ?? ""}`}>{STATUS_LABELS[order.status] ?? order.status}</span>
                      </td>
                      <td>
                        <span className={styles.payment} title={METHOD_NAMES[order.payment_method] ?? order.payment_method}>
                          <MethodMark provider={order.payment_method} small />
                          <span className={`${ws.tag} ${order.payment_status === "PAID" ? "" : ws.tagWarn}`}>
                            {order.payment_method === "COD" && order.payment_status !== "PAID" ? "COD" : PAYMENT_LABELS[order.payment_status] ?? order.payment_status}
                          </span>
                        </span>
                      </td>
                      <td className={ws.numeric}>{formatBdt(order.grand_total)}</td>
                      <td title={formatDateTime(order.created_at)}>{timeAgo(order.created_at)}</td>
                      <td>
                        <ChevronRight size={16} className={styles.chevron} />
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}

      {!error && totalCount > 0 && (
        <div className={styles.pager}>
          <span>
            {from.toLocaleString("en-US")}–{to.toLocaleString("en-US")} of {totalCount.toLocaleString("en-US")}
          </span>
          {totalCount > pageSize && (
            <div className={styles.pagerButtons}>
              <button type="button" className={ws.quietButton} disabled={page === 0 || isLoading} onClick={() => onPageChange(page - 1)}>
                Previous
              </button>
              <button type="button" className={ws.quietButton} disabled={to >= totalCount || isLoading} onClick={() => onPageChange(page + 1)}>
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
