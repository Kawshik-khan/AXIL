import { AppError } from "@/lib/errors";
import type { GatewayCredentials, GatewayMode, GatewayProvider } from "@/types/payments";

/** What a gateway adapter is given to open one hosted checkout. */
export interface GatewayCheckoutRequest {
  /** Our reference for this attempt: the gateway carries it back (SSLCommerz tran_id, bKash merchantInvoiceNumber). */
  attemptId: string;
  amount: number;
  /** Shown on the gateway's page, e.g. "Order ORD-1042". */
  description: string;
  customer: { name: string; phone: string; email: string; address?: string; city?: string; postcode?: string };
  /** This app's public base URL; each adapter builds its own return and notification URLs under it. */
  appBaseUrl: string;
}

export interface GatewayCheckoutSession {
  /** Where the payer's browser goes next. */
  redirectUrl: string;
  /** The gateway's own id for the session (bKash paymentId, SSLCommerz sessionkey). */
  gatewayReference: string;
}

/** What the payer's browser (or the gateway's server) brought back. Untrusted: it only says where to look. */
export interface GatewayReturn {
  /** SSLCommerz: val_id. bKash: paymentID. */
  reference?: string;
  /** The status the callback claims. Never proof: `confirm` asks the gateway. */
  claimedStatus?: string;
}

/**
 * The gateway's own answer about one attempt, read from its API with the merchant's credentials.
 * PAID is returned only when the gateway reports a completed payment for this attempt's reference; the caller still
 * compares the amount and currency before recording anything.
 */
export type GatewayConfirmation =
  | {
      status: "PAID";
      transactionId: string;
      amount: number;
      currency: string;
      attemptId: string;
      /** How the payer paid at an aggregator, as the gateway names it (SSLCommerz card_type, e.g. "BKASH-BKash"). */
      channel?: string;
    }
  | { status: "FAILED" | "CANCELLED" | "PENDING"; reason: string };

export interface GatewayAccount<C extends GatewayCredentials = GatewayCredentials> {
  mode: GatewayMode;
  credentials: C;
}

export interface PaymentGatewayAdapter {
  readonly provider: GatewayProvider;
  createCheckout(account: GatewayAccount, request: GatewayCheckoutRequest): Promise<GatewayCheckoutSession>;
  confirm(
    account: GatewayAccount,
    attempt: { id: string; gatewayReference?: string },
    returned: GatewayReturn
  ): Promise<GatewayConfirmation>;
}

/** The gateway refused the request or answered something unusable. The message never carries the gateway's body. */
export class PaymentGatewayError extends AppError {
  constructor(provider: GatewayProvider, what: string) {
    super("PAYMENT_GATEWAY_ERROR", `${provider === "BKASH" ? "bKash" : "SSLCommerz"} ${what}. No payment was taken.`, 502, { provider });
  }
}

/** The gateway's hosted page must be https on the provider's own domain before a payer's browser is sent there. */
export function assertGatewayRedirect(provider: GatewayProvider, raw: string, domains: readonly string[]): string {
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" && domains.some((d) => url.hostname === d || url.hostname.endsWith(`.${d}`))) return url.toString();
  } catch {
    // fall through
  }
  throw new PaymentGatewayError(provider, "returned a checkout address that is not its own");
}

/** Our attempt reference: "gp" + 26 hex. Checked before any lookup or rate-limit key is built from request input. */
export const ATTEMPT_ID_PATTERN = /^gp[0-9a-f]{26}$/;
/** A payment link token: URL-safe, 32 to 64 characters. */
export const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

/** Amounts are BDT with at most two decimals; gateways take them as "1250.00". */
export function formatAmount(amount: number): string {
  return (Math.round(amount * 100) / 100).toFixed(2);
}

/** Two amounts are the same payment when they differ by less than one paisa. */
export function sameAmount(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.005;
}

export function parseJsonObject(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The first of these keys that holds a non-empty string or a number, as a string (gateways disagree on key casing). */
export function pick(source: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}
