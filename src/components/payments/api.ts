/** Browser helpers shared by the payments and billing pages. */
import { fetchWithStepUp } from "@/lib/step-up-client";

export interface ApiFailure {
  code: string;
  message: string;
  request_id?: string;
  details?: Record<string, unknown>;
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: ApiFailure | null;
}

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error?: ApiFailure;
}

/** Calls an /api/v1 route and unwraps the standard envelope. Never throws: a network failure is an error result. */
export async function api<T>(url: string, init: RequestInit & { json?: unknown; stepUp?: boolean } = {}): Promise<ApiResult<T>> {
  const { json, stepUp, ...rest } = init;
  const request: RequestInit = {
    credentials: "include",
    cache: "no-store",
    ...rest,
    ...(json !== undefined ? { body: JSON.stringify(json), headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) } } : {}),
  };
  try {
    const response = stepUp ? await fetchWithStepUp(url, request) : await fetch(url, request);
    const body = (await response.json().catch(() => null)) as Envelope<T> | null;
    if (response.ok && body?.success !== false) return { ok: true, status: response.status, data: body?.data ?? null, error: null };
    return {
      ok: false,
      status: response.status,
      data: null,
      error: body?.error ?? { code: "REQUEST_FAILED", message: "The request could not be completed." },
    };
  } catch {
    return { ok: false, status: 0, data: null, error: { code: "NETWORK_ERROR", message: "Could not reach the server. Check your connection and try again." } };
  }
}

export function formatBdt(amount: number): string {
  return `৳${amount.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export function formatDate(iso: string | undefined | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export const GATEWAY_NAMES: Record<string, string> = {
  SSLCOMMERZ: "SSLCommerz",
  BKASH: "bKash",
};

export const GATEWAY_HINTS: Record<string, string> = {
  SSLCOMMERZ: "bKash, Nagad, Rocket, cards, internet banking",
  BKASH: "Pay from your bKash app or number",
};
