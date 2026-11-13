/**
 * bKash Tokenized Checkout, v2 "Tokenized Without Agreement" (developer.bka.sh/docs/tokenized-without-agreement).
 *
 *   1. Grant Token (username + password headers, app_key + app_secret body). bKash allows two grant calls an hour and
 *      blocks the app beyond that, so the token is kept for 50 minutes per account.
 *   2. Create Payment returns bkashURL; the payer approves with their PIN there.
 *   3. bKash sends the browser back to callbackURL with ?paymentID=…&status=success|failure|cancel. That only means
 *      "now ask": confirm calls Execute Payment, and Query Payment when Execute gives no usable answer.
 *
 * Sandbox host: a constant. bKash does not publish the production host; it hands it over with live credentials, so
 * LIVE mode reads it from BKASH_LIVE_BASE_URL (platform environment, never a tenant setting) and is refused without it.
 */
import crypto from "crypto";
import { outboundRequest } from "@/lib/outbound-http";
import { IntegrationNotConfiguredError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { BkashCredentials, GatewayMode } from "@/types/payments";
import {
  assertGatewayRedirect,
  formatAmount,
  parseJsonObject,
  pick,
  PaymentGatewayError,
  type GatewayAccount,
  type GatewayCheckoutRequest,
  type GatewayCheckoutSession,
  type GatewayConfirmation,
  type GatewayReturn,
  type PaymentGatewayAdapter,
} from "./gateway.types";

const SANDBOX_BASE = "https://tokenized.sandbox.bka.sh/v2/tokenized-checkout";
/** bKash gives every call 30 s; Execute can take most of it. */
const TIMEOUT_MS = 30_000;
const TOKEN_TTL_MS = 50 * 60_000;

function baseUrl(mode: GatewayMode): string {
  if (mode === "SANDBOX") return SANDBOX_BASE;
  const live = process.env.BKASH_LIVE_BASE_URL?.trim().replace(/\/+$/, "");
  if (!live || !/^https:\/\/[a-z0-9.-]+\.(bka\.sh|bkash\.com)\//i.test(`${live}/`)) {
    throw new IntegrationNotConfiguredError("bKash live checkout", "BKASH_LIVE_BASE_URL is not set to the production URL bKash issued");
  }
  return live;
}

function credentials(account: GatewayAccount): BkashCredentials {
  return account.credentials as BkashCredentials;
}

/** After bKash refuses a grant, no new grant for this account for a while: two calls an hour is all it allows. */
const REFUSAL_BACKOFF_MS = 20 * 60_000;

const tokens = new Map<string, { token: string; expiresAt: number }>();
/** One grant call at a time per account, however many checkouts ask together. */
const grantsInFlight = new Map<string, Promise<string>>();
const refusedUntil = new Map<string, number>();

function tokenKey(account: GatewayAccount): string {
  const c = credentials(account);
  return crypto.createHash("sha256").update(`${account.mode}\n${c.app_key}\n${c.username}\n${c.app_secret}\n${c.password}`).digest("hex");
}

/** Tests: forget cached tokens. */
export function resetBkashTokensForTesting(): void {
  tokens.clear();
  grantsInFlight.clear();
  refusedUntil.clear();
}

async function idToken(account: GatewayAccount): Promise<string> {
  const key = tokenKey(account);
  const cached = tokens.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  if ((refusedUntil.get(key) ?? 0) > Date.now()) throw new PaymentGatewayError("BKASH", "did not accept the merchant credentials");
  const running = grantsInFlight.get(key);
  if (running) return running;
  const grant = grantToken(account, key).finally(() => grantsInFlight.delete(key));
  grantsInFlight.set(key, grant);
  return grant;
}

async function grantToken(account: GatewayAccount, key: string): Promise<string> {
  const c = credentials(account);
  const response = await outboundRequest(`${baseUrl(account.mode)}/auth/grant-token`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", username: c.username, password: c.password },
    body: JSON.stringify({ app_key: c.app_key, app_secret: c.app_secret }),
    timeoutMs: TIMEOUT_MS,
  });
  const body = parseJsonObject(response.body);
  const token = body ? pick(body, "id_token") : undefined;
  if (response.status !== 200 || !token) {
    logger.warn("payments.bkash.grant_refused", { http_status: response.status, status_code: body ? pick(body, "statusCode") ?? null : null });
    refusedUntil.set(key, Date.now() + REFUSAL_BACKOFF_MS);
    throw new PaymentGatewayError("BKASH", "did not accept the merchant credentials");
  }
  tokens.set(key, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

async function call(account: GatewayAccount, path: string, payload: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const response = await outboundRequest(`${baseUrl(account.mode)}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: await idToken(account),
      "x-app-key": credentials(account).app_key,
    },
    body: JSON.stringify(payload),
    timeoutMs: TIMEOUT_MS,
  });
  // An expired or revoked token: forget it so the next call grants a new one.
  if (response.status === 401) tokens.delete(tokenKey(account));
  return { status: response.status, body: parseJsonObject(response.body) };
}

function completed(body: Record<string, unknown>, paymentId: string): GatewayConfirmation | null {
  if (pick(body, "transactionStatus") !== "Completed") return null;
  const transactionId = pick(body, "trxId", "trxID");
  if (!transactionId) return null;
  if ((pick(body, "paymentId", "paymentID") ?? paymentId) !== paymentId) return null;
  return {
    status: "PAID",
    transactionId,
    amount: Number(pick(body, "amount")),
    currency: pick(body, "currency") ?? "",
    // Execute names it merchantInvoiceNumber, Query merchantInvoice
    attemptId: pick(body, "merchantInvoiceNumber", "merchantInvoice") ?? "",
  };
}

export const bkashAdapter: PaymentGatewayAdapter = {
  provider: "BKASH",

  async createCheckout(account: GatewayAccount, request: GatewayCheckoutRequest): Promise<GatewayCheckoutSession> {
    const { status, body } = await call(account, "/payment/create", {
      // Not the customer's number: bKash shows it on its page, and whoever holds the link would see it
      payerReference: request.attemptId,
      callbackURL: `${request.appBaseUrl}/pay/return/bkash/${request.attemptId}`,
      amount: formatAmount(request.amount),
      currency: "BDT",
      intent: "sale",
      merchantInvoiceNumber: request.attemptId,
    });
    const paymentId = body ? pick(body, "paymentId", "paymentID") : undefined;
    const redirectUrl = body ? pick(body, "bkashURL", "bKashURL") : undefined;
    if (status !== 200 || !paymentId || !redirectUrl) {
      logger.warn("payments.bkash.create_refused", { http_status: status, code: body ? pick(body, "externalCode", "statusCode") ?? null : null });
      throw new PaymentGatewayError("BKASH", "did not open a payment");
    }
    return { redirectUrl: assertGatewayRedirect("BKASH", redirectUrl, ["bka.sh", "bkash.com"]), gatewayReference: paymentId };
  },

  async confirm(
    account: GatewayAccount,
    attempt: { id: string; gatewayReference?: string },
    returned: GatewayReturn
  ): Promise<GatewayConfirmation> {
    const paymentId = attempt.gatewayReference;
    if (!paymentId) return { status: "PENDING", reason: "This attempt never reached bKash." };
    // The paymentID in the callback must be the one bKash issued for this attempt, whatever status it claims.
    if (returned.reference && returned.reference !== paymentId) {
      return { status: "FAILED", reason: "The bKash payment id does not belong to this attempt." };
    }
    const claimed = (returned.claimedStatus || "").toLowerCase();

    if (claimed === "success") {
      let executed: { status: number; body: Record<string, unknown> | null } | null = null;
      try {
        executed = await call(account, "/payment/execute", { paymentId });
      } catch (err) {
        // bKash: when Execute gives no answer, do not retry it; ask Query Payment.
        logger.warn("payments.bkash.execute_unanswered", { error: err instanceof Error ? err.message : String(err) });
      }
      const paid = executed?.status === 200 && executed.body ? completed(executed.body, paymentId) : null;
      if (paid) return paid;
    }

    // Cancelled, failed, an Execute that gave no usable answer, or a repeat of a callback already executed.
    const queried = await call(account, "/query/payment", { paymentId });
    if (queried.status !== 200 || !queried.body) throw new PaymentGatewayError("BKASH", "could not be asked about this payment");
    const paid = completed(queried.body, paymentId);
    if (paid) return paid;
    if (claimed === "cancel") return { status: "CANCELLED", reason: "The payment was cancelled at bKash." };
    if (claimed === "failure") return { status: "FAILED", reason: "bKash reported a failed payment." };
    return { status: "PENDING", reason: "bKash has not completed this payment." };
  },
};

/** What bKash's Search Transaction said about one transaction id (ADR-124). */
export interface BkashTransactionLookup {
  found: boolean;
  trxId?: string;
  /** e.g. "Completed". */
  status?: string;
  amount?: number;
  currency?: string;
  /** ISO time, when bKash gave one we could read. */
  completedAt?: string;
  transactionType?: string;
  /** Last 4 digits of the paying number. Only these leave the adapter; the full number is never kept. */
  payerLast4?: string;
  /** bKash's own code when it did not find the transaction. */
  code?: string;
}

/**
 * bKash writes times like "2024-01-27T10:57:45:476 GMT+0600" (milliseconds after a colon, offset without one).
 * Returns ISO, or undefined when it is not a time we can trust.
 */
export function parseBkashTime(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:[:.](\d{1,3}))?\s*GMT\s*([+-])(\d{2}):?(\d{2})$/.exec(raw.trim());
  const iso = m ? `${m[1]}T${m[2]}.${(m[3] ?? "0").padEnd(3, "0")}${m[4]}${m[5]}:${m[6]}` : raw.trim();
  const time = Date.parse(iso);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

/**
 * Search Transaction (tokenized checkout, general/searchTransaction): looks up a transaction id with the merchant's
 * credentials, so only that merchant's transactions come back. Throws PaymentGatewayError when bKash can't be asked.
 */
export async function searchBkashTransaction(account: GatewayAccount, trxId: string): Promise<BkashTransactionLookup> {
  const { status, body } = await call(account, "/general/searchTransaction", { trxID: trxId });
  if (status !== 200 || !body) {
    logger.warn("payments.bkash.search_unanswered", { http_status: status });
    throw new PaymentGatewayError("BKASH", "could not be asked about this transaction");
  }
  const transactionStatus = pick(body, "transactionStatus");
  const foundId = pick(body, "trxID", "trxId");
  if (!transactionStatus || !foundId) {
    return { found: false, code: pick(body, "statusCode", "externalCode", "errorCode") ?? undefined };
  }
  const amount = Number(pick(body, "amount"));
  const payerDigits = (pick(body, "customerMsisdn") ?? "").replace(/\D/g, "");
  return {
    found: true,
    trxId: foundId,
    status: transactionStatus,
    amount: Number.isFinite(amount) ? amount : undefined,
    currency: pick(body, "currency") ?? undefined,
    completedAt: parseBkashTime(pick(body, "completedTime") ?? undefined),
    transactionType: pick(body, "transactionType") ?? undefined,
    payerLast4: payerDigits.length >= 4 ? payerDigits.slice(-4) : undefined,
  };
}
