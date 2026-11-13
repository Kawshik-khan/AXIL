"use client";

import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import { api, formatBdt, formatDateTime } from "./api";
import { linkUrl } from "./CreatePaymentLinkPanel";
import { timeAgo, timeUntil } from "./payment-ui";
import ws from "@/components/ui/WorkScreen/WorkScreen.module.css";

export interface PaymentLinkView {
  id: string;
  order_id: string;
  order_number: string;
  amount: number;
  note?: string;
  status: "ACTIVE" | "PAID" | "CANCELLED";
  expired: boolean;
  expires_at: string;
  created_at: string;
  paid_at?: string;
  path: string;
  url: string | null;
}

type Filter = "all" | "open" | "paid" | "closed";

function linkState(link: PaymentLinkView): Exclude<Filter, "all"> {
  if (link.status === "PAID") return "paid";
  if (link.status === "CANCELLED" || link.expired) return "closed";
  return "open";
}

function statusBadge(link: PaymentLinkView): { label: string; className: string } {
  if (link.status === "PAID") return { label: "Paid", className: ws.statusOk };
  if (link.status === "CANCELLED") return { label: "Cancelled", className: ws.statusMuted };
  if (link.expired) return { label: "Expired", className: ws.statusDanger };
  return { label: "Waiting for payment", className: ws.statusWarn };
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Waiting" },
  { key: "paid", label: "Paid" },
  { key: "closed", label: "Expired / cancelled" },
];

/** Every payment link this shop made, filterable by state; copy or cancel the ones still open. */
export function PaymentLinksPanel({ links, canCreate, onChanged }: { links: PaymentLinkView[]; canCreate: boolean; onChanged: () => Promise<void> | void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const counts = links.reduce<Record<Filter, number>>(
    (acc, link) => {
      acc[linkState(link)] += 1;
      return acc;
    },
    { all: links.length, open: 0, paid: 0, closed: 0 },
  );
  const shown = filter === "all" ? links : links.filter((link) => linkState(link) === filter);

  const copy = async (link: PaymentLinkView) => {
    try {
      await navigator.clipboard.writeText(linkUrl(link));
      setCopied(link.id);
      window.setTimeout(() => setCopied((id) => (id === link.id ? null : id)), 2000);
    } catch {
      setError("Could not copy. Open the link and copy it from the address bar.");
    }
  };

  const cancel = async (link: PaymentLinkView) => {
    setError(null);
    setBusy(link.id);
    const result = await api(`/api/v1/payments/links/${encodeURIComponent(link.id)}/cancel`, { method: "POST" });
    setBusy(null);
    if (!result.ok) setError(result.error?.message ?? "Could not cancel the link.");
    await onChanged();
  };

  return (
    <section className={ws.section} aria-labelledby="payment-links-title">
      <div className={ws.sectionHead}>
        <div>
          <h2 id="payment-links-title" className={ws.sectionTitle}>
            Payment links
          </h2>
          <p className={ws.sectionHint}>Ask a customer to pay an order, or part of it such as the delivery charge.</p>
        </div>
        {links.length > 0 && (
          <div className={ws.tabs} role="tablist" aria-label="Filter payment links">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                className={`${ws.tab} ${filter === f.key ? ws.tabActive : ""}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                <span className={ws.tabCount}>{counts[f.key]}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className={ws.notice} role="alert">
          {error}
        </div>
      )}

      {links.length === 0 ? (
        <div className={ws.empty}>
          <p className={ws.emptyTitle}>No payment links yet</p>
          <p className={ws.emptyText}>
            {canCreate ? "Use “New payment link” to ask a customer for an advance or the full amount." : "Links your team makes will appear here."}
          </p>
        </div>
      ) : shown.length === 0 ? (
        <div className={ws.empty}>
          <p className={ws.emptyTitle}>Nothing here</p>
          <p className={ws.emptyText}>No links match this filter.</p>
        </div>
      ) : (
        <div className={ws.tableScroll}>
          <table className={ws.table}>
            <thead>
              <tr>
                <th>Order</th>
                <th>Status</th>
                <th className={ws.numeric}>Amount</th>
                <th>Created</th>
                <th>Expires / paid</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shown.map((link) => {
                const badge = statusBadge(link);
                const open = linkState(link) === "open";
                return (
                  <tr key={link.id}>
                    <td>
                      <div className={ws.orderNumber}>{link.order_number}</div>
                      {link.note && <div className={ws.note}>{link.note}</div>}
                    </td>
                    <td>
                      <span className={`${ws.status} ${badge.className}`}>{badge.label}</span>
                    </td>
                    <td className={ws.numeric}>{formatBdt(link.amount)}</td>
                    <td title={formatDateTime(link.created_at)}>{timeAgo(link.created_at)}</td>
                    <td title={formatDateTime(link.status === "PAID" ? link.paid_at : link.expires_at)}>
                      {link.status === "PAID" ? `Paid ${timeAgo(link.paid_at)}` : link.status === "CANCELLED" ? "-" : timeUntil(link.expires_at)}
                    </td>
                    <td>
                      {open && (
                        <div className={ws.rowActions}>
                          <button type="button" className={ws.quietButton} onClick={() => void copy(link)}>
                            {copied === link.id ? <Check size={14} /> : <Copy size={14} />}
                            {copied === link.id ? "Copied" : "Copy link"}
                          </button>
                          {canCreate && (
                            <button type="button" className={ws.textButton} disabled={busy !== null} onClick={() => void cancel(link)}>
                              {busy === link.id ? "Cancelling…" : "Cancel"}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
