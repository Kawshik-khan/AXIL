"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ApiFailure } from "@/components/payments/api";
import type { db } from "@/infrastructure/db";
import type { Opportunity, Recommendation, Risk } from "@/types/intelligence";

/** Shapes of the endpoints the shop dashboard reads (type-only; nothing server-side is bundled). */
export type DashboardMetrics = ReturnType<typeof db.getDashboardMetrics>;
export interface IntelligenceOverview {
  top_risks?: Risk[];
  top_opportunities?: Opportunity[];
  top_recommendations?: Recommendation[];
}
export interface DashboardSession {
  role?: string;
  tenant?: { name?: string; currency?: string };
}

/** One endpoint's result. `data` keeps the last good answer while a new one loads. */
interface SectionResult<T> {
  data: T | null;
  status: number;
  error: ApiFailure | null;
  loading: boolean;
}
export interface Section<T> extends SectionResult<T> {
  reload: () => void;
}

/** Reads one endpoint. Sections load and fail on their own, so one slow or forbidden endpoint never blanks the page. */
export function useSection<T>(url: string): Section<T> {
  const router = useRouter();
  const [result, setResult] = useState<SectionResult<T>>({ data: null, status: 0, error: null, loading: true });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setResult((prev) => ({ ...prev, loading: true }));
    void api<T>(url).then(({ data, status, error }) => {
      if (cancelled) return;
      if (status === 401) router.push("/login");
      setResult({ data, status, error, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [url, attempt, router]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...result, reload };
}

// ---------------------------------------------------------------- money

export type CurrencyCode = "BDT" | "USD" | "EUR" | "GBP";
export interface Currency {
  code: CurrencyCode;
  symbol: string;
  /** 1 BDT in this currency. Fixed display rates, not live FX: converted amounts carry a ≈ sign. */
  rate: number;
  format: (amountBdt: number) => string;
}

const USD_PER_BDT = 1 / 110;

function currency(code: CurrencyCode, symbol: string, rate: number, locale: string): Currency {
  const prefix = rate === 1 ? "" : "≈";
  return { code, symbol, rate, format: (bdt) => `${prefix}${symbol}${Math.round(bdt * rate).toLocaleString(locale)}` };
}

export const CURRENCIES: Record<CurrencyCode, Currency> = {
  BDT: currency("BDT", "৳", 1, "en-BD"),
  USD: currency("USD", "$", USD_PER_BDT, "en-US"),
  EUR: currency("EUR", "€", 0.92 * USD_PER_BDT, "de-DE"),
  GBP: currency("GBP", "£", 0.79 * USD_PER_BDT, "en-GB"),
};

export const isCurrencyCode = (code: string | undefined): code is CurrencyCode => Boolean(code && code in CURRENCIES);

/** A short axis label in the shown currency, e.g. ৳20K. */
export const compactMoney = ({ symbol, rate }: Currency, bdt: number) =>
  `${rate === 1 ? "" : "≈"}${symbol}${(bdt * rate).toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 })}`;

// ---------------------------------------------------------------- labels

export const formatCount = (n: number) => n.toLocaleString("en-US");

/** READY_TO_SHIP → "Ready to ship" */
export const readable = (value: string | null | undefined) =>
  value ? value.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "—";

const PAYMENT_NAMES: Record<string, string> = { COD: "COD", BKASH: "bKash", SSLCOMMERZ: "SSLCommerz" };
export const paymentName = (method: string | null | undefined) => (method ? PAYMENT_NAMES[method] ?? readable(method) : "—");

export function timeAgo(iso: string | undefined): string {
  const at = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(at)) return "—";
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

/** Channel colours follow the channel, never its rank (tokens.css → --chart-ch-*). */
const CHANNEL_COLORS: Record<string, string> = {
  facebook: "var(--chart-ch-facebook)",
  whatsapp: "var(--chart-ch-whatsapp)",
  instagram: "var(--chart-ch-instagram)",
  website: "var(--chart-ch-website)",
  manual: "var(--chart-ch-manual)",
};
export const channelColor = (id: string | undefined) => (id && CHANNEL_COLORS[id]) || "var(--chart-ch-unattributed)";
