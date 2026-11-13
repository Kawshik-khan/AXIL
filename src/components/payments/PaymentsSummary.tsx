"use client";

import React from "react";
import type { Payment } from "@/types/commerce";
import { formatBdt } from "./api";
import type { PaymentLinkView } from "./PaymentLinksPanel";
import ws from "@/components/ui/WorkScreen/WorkScreen.module.css";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Payments a customer says they made and staff have not confirmed or rejected yet. */
export function awaitingConfirmation(payments: Payment[]): Payment[] {
  return payments.filter((p) => p.status === "PENDING" && p.provider !== "COD" && p.transaction_id);
}

function isToday(iso: string | undefined, now: Date): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

const sum = (amounts: number[]) => amounts.reduce((total, amount) => total + amount, 0);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Four numbers computed from the payments and links this page already loaded: nothing is stored or estimated.
 * Sandbox (test-mode) payments moved no real money, so they are left out of the confirmed total.
 */
export function PaymentsSummary({ payments, links }: { payments: Payment[]; links: PaymentLinkView[] }) {
  const now = new Date();
  const waiting = awaitingConfirmation(payments);
  const confirmedToday = payments.filter((p) => p.status === "PAID" && !p.test_mode && isToday(p.verified_at ?? p.created_at, now));
  const open = links.filter((l) => l.status === "ACTIVE" && !l.expired);
  const expiringSoon = open.filter((l) => new Date(l.expires_at).getTime() - now.getTime() < DAY_MS);

  const stats = [
    {
      label: "Waiting for you",
      value: formatBdt(sum(waiting.map((p) => p.amount))),
      meta: waiting.length ? `${plural(waiting.length, "payment", "payments")} to check` : "Nothing to check",
      live: waiting.length > 0,
    },
    {
      label: "Confirmed today",
      value: formatBdt(sum(confirmedToday.map((p) => p.amount))),
      meta: plural(confirmedToday.length, "payment", "payments"),
    },
    {
      label: "Open links",
      value: String(open.length),
      meta: open.length ? `${formatBdt(sum(open.map((l) => l.amount)))} requested` : "None waiting",
    },
    {
      label: "Expiring in 24h",
      value: String(expiringSoon.length),
      meta: expiringSoon.length ? "Remind these customers" : "All good",
    },
  ];

  return (
    <section className={ws.stats} aria-label="Payments summary">
      {stats.map((stat) => (
        <div key={stat.label} className={ws.stat}>
          <span className={ws.statLabel}>
            {stat.live && <span className={ws.liveDot} aria-hidden="true" />}
            {stat.label}
          </span>
          <span className={ws.statValue}>{stat.value}</span>
          <span className={ws.statMeta}>{stat.meta}</span>
        </div>
      ))}
    </section>
  );
}
