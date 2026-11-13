"use client";

import React from "react";
import { CreditCard, Wallet } from "lucide-react";
import styles from "./PaymentsPage.module.css";
import ws from "@/components/ui/WorkScreen/WorkScreen.module.css";

export const METHOD_NAMES: Record<string, string> = { BKASH: "bKash", NAGAD: "Nagad", ROCKET: "Rocket", CARD: "Card / bank", COD: "Cash on delivery" };

const MARKS: Record<string, { letter: string; className: string }> = {
  BKASH: { letter: "b", className: styles.markBkash },
  NAGAD: { letter: "N", className: styles.markNagad },
  ROCKET: { letter: "R", className: styles.markRocket },
};

/** A wallet's brand-coloured mark, so staff recognise the method at a glance. */
export function MethodMark({ provider, small = false }: { provider: string; small?: boolean }) {
  const mark = MARKS[provider];
  const className = `${styles.mark} ${small ? styles.markSm : ""} ${mark?.className ?? ""}`;
  return (
    <span className={className} aria-hidden="true">
      {mark ? mark.letter : provider === "CARD" ? <CreditCard size={small ? 12 : 16} /> : <Wallet size={small ? 12 : 16} />}
    </span>
  );
}

/** "just now", "5m ago", "3h ago", "2d ago"; falls back to "-" for a missing or bad date. */
export function timeAgo(iso: string | undefined | null, now: number = Date.now()): string {
  if (!iso) return "-";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "-";
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** "in 3h", "in 2d", or "expired" for a time in the past. */
export function timeUntil(iso: string | undefined | null, now: number = Date.now()): string {
  if (!iso) return "-";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "-";
  const minutes = Math.round((then - now) / 60_000);
  if (minutes <= 0) return "expired";
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}
