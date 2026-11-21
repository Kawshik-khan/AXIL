"use client";

import React, { useState } from "react";
import { ChevronRight, MessageCircle, Phone } from "lucide-react";
import type { CustomerListItem } from "@/lib/customer-segments";
import {
  SEGMENT_LABELS,
  channelsOf,
  displayName,
  districtOf,
  formatTaka,
  initialsOf,
  monthYear,
  phoneDigits,
  relativeTime,
  tintOf,
  type ChannelDisplay,
} from "./customer-display";
import styles from "./customers.module.css";

const SEGMENT_CLASS = {
  NEW: styles.segNew,
  ONE_TIME: styles.segOneTime,
  REPEAT: styles.segRepeat,
  HIGH_VALUE: styles.segHighValue,
} as const;

const TINT_CLASS = [styles.tint0, styles.tint1, styles.tint2, styles.tint3] as const;

const MARK_CLASS: Record<ChannelDisplay["markClass"], string> = {
  facebook: styles.markFacebook,
  instagram: styles.markInstagram,
  whatsapp: styles.markWhatsapp,
  web: styles.markWeb,
  tiktok: styles.markTiktok,
  telegram: styles.markTelegram,
  neutral: styles.markNeutral,
};

function ChannelChip({ channel }: { channel: ChannelDisplay }) {
  return (
    <span className={styles.channel}>
      <span className={`${styles.mark} ${MARK_CLASS[channel.markClass]}`} aria-hidden="true">
        {channel.mark}
      </span>
      {channel.label}
    </span>
  );
}

function Channels({ customer }: { customer: CustomerListItem }) {
  const list = channelsOf(customer);
  return (
    <span className={styles.channels}>
      <ChannelChip channel={list[0]} />
      {list.length > 1 && (
        <span className={styles.more} title={list.slice(1).map((c) => c.label).join(", ")}>
          +{list.length - 1}
        </span>
      )}
    </span>
  );
}

interface CardProps {
  customer: CustomerListItem;
  name: string;
  above: boolean;
  onOpen: () => void;
}

function QuickView({ customer, name, above, onOpen }: CardProps) {
  const digits = phoneDigits(customer.phone);
  const district = districtOf(customer);
  const since = monthYear(customer.created_at);
  const lastOrder = relativeTime(customer.last_order_at);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className={`${styles.card} ${above ? styles.cardAbove : ""}`}
      role="dialog"
      aria-label={`${name} quick view`}
      onClick={stop}
    >
      <div className={styles.cardHead}>
        <div className={styles.identity}>
          <span className={`${styles.avatar} ${styles.avatarLg} ${TINT_CLASS[tintOf(customer.id)]}`} aria-hidden="true">
            {initialsOf(name)}
          </span>
          <div className={styles.identityText}>
            <span className={styles.cardName}>{name}</span>
            <span className={styles.sub}>
              {SEGMENT_LABELS[customer.segment]} customer{district ? ` · ${district}` : ""}
            </span>
          </div>
        </div>
        {digits && (
          <div className={styles.cardActions}>
            <a href={`tel:+${digits}`} className={styles.roundAction} aria-label={`Call ${name}`}>
              <Phone size={15} />
            </a>
            <a
              href={`https://wa.me/${digits}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`${styles.roundAction} ${styles.roundWhatsapp}`}
              aria-label={`WhatsApp ${name}`}
            >
              <MessageCircle size={15} />
            </a>
          </div>
        )}
      </div>
      <dl className={styles.details}>
        <dt>Phone</dt>
        <dd className={customer.phone ? styles.tabular : styles.muted}>{customer.phone || "Not added"}</dd>
        <dt>Email</dt>
        <dd className={customer.email ? "" : styles.muted}>{customer.email || "Not added"}</dd>
        <dt>District</dt>
        <dd className={district ? "" : styles.muted}>{district || "Not added"}</dd>
        <dt>Channel</dt>
        <dd className={styles.channelList}>
          {channelsOf(customer).map((ch) => (
            <ChannelChip key={ch.label} channel={ch} />
          ))}
        </dd>
        <dt>Orders</dt>
        <dd className={styles.tabular}>{customer.total_orders ?? 0}</dd>
        <dt>Lifetime value</dt>
        <dd className={`${styles.tabular} ${styles.strong}`}>{formatTaka(customer.total_spent)}</dd>
        {since && (
          <>
            <dt>Customer since</dt>
            <dd>{since}</dd>
          </>
        )}
      </dl>
      <div className={styles.cardFoot}>
        <span>
          {lastOrder ? `Last order ${lastOrder.toLowerCase()}` : (customer.total_orders ?? 0) > 0 ? "" : "No orders yet"}
        </span>
        <button type="button" className={styles.linkButton} onClick={onOpen}>
          Open profile →
        </button>
      </div>
    </div>
  );
}

export interface CustomerTableProps {
  customers: CustomerListItem[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (id: string) => void;
}

export function CustomerTable({ customers, selected, onToggle, onToggleAll, onOpen }: CustomerTableProps) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const allChecked = customers.length > 0 && customers.every((c) => selected.has(c.id));
  const someChecked = !allChecked && customers.some((c) => selected.has(c.id));

  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.checkCol}>
              <input
                type="checkbox"
                className={styles.checkbox}
                aria-label="Select all customers on this page"
                checked={allChecked}
                ref={(el) => {
                  if (el) el.indeterminate = someChecked;
                }}
                onChange={onToggleAll}
              />
            </th>
            <th>Customer</th>
            <th>District</th>
            <th>Channel</th>
            <th>Segment</th>
            <th className={styles.num}>Orders</th>
            <th className={styles.num}>Lifetime value</th>
            <th>Last order</th>
            <th className={styles.actionCol}>
              <span className={styles.srOnly}>Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c, index) => {
            const name = displayName(c);
            const district = districtOf(c);
            const lastOrder = relativeTime(c.last_order_at);
            const checked = selected.has(c.id);
            const orders = c.total_orders ?? 0;
            const spent = c.total_spent ?? 0;
            return (
              <tr
                key={c.id}
                className={`${styles.row} ${checked ? styles.rowSelected : ""}`}
                onClick={() => onOpen(c.id)}
                onMouseLeave={() => setPreviewId((id) => (id === c.id ? null : id))}
              >
                <td className={styles.checkCol} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    aria-label={`Select ${name}`}
                    checked={checked}
                    onChange={() => onToggle(c.id)}
                  />
                </td>
                <td className={styles.customerCell}>
                  <div
                    className={styles.identity}
                    onMouseEnter={() => setPreviewId(c.id)}
                    onFocus={() => setPreviewId(c.id)}
                    onBlur={(e) => {
                      if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) setPreviewId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setPreviewId(null);
                    }}
                  >
                    <span className={`${styles.avatar} ${TINT_CLASS[tintOf(c.id)]}`} aria-hidden="true">
                      {initialsOf(name)}
                    </span>
                    <div className={styles.identityText}>
                      <button
                        type="button"
                        className={styles.nameButton}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(c.id);
                        }}
                      >
                        {name}
                      </button>
                      <span className={c.phone ? `${styles.sub} ${styles.tabular}` : styles.sub}>
                        {c.phone || "No phone"}
                      </span>
                    </div>
                  </div>
                  {previewId === c.id && (
                    <QuickView
                      customer={c}
                      name={name}
                      above={index >= 4 && index >= customers.length - 3}
                      onOpen={() => onOpen(c.id)}
                    />
                  )}
                </td>
                <td className={district ? "" : styles.muted}>{district ?? "—"}</td>
                <td>
                  <Channels customer={c} />
                </td>
                <td>
                  <span className={`${styles.segment} ${SEGMENT_CLASS[c.segment]}`}>{SEGMENT_LABELS[c.segment]}</span>
                </td>
                <td className={`${styles.num} ${orders ? "" : styles.muted}`}>{orders}</td>
                <td className={`${styles.num} ${spent ? styles.strong : styles.muted}`}>{formatTaka(spent)}</td>
                <td className={lastOrder ? styles.secondary : styles.muted}>{lastOrder ?? "—"}</td>
                <td className={styles.actionCol}>
                  <span className={styles.chevron} aria-hidden="true">
                    <ChevronRight size={16} />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
