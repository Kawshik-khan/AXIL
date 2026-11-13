/**
 * SSLCommerz hosted checkout (developer.sslcommerz.com/doc/v4): one page for bKash, Nagad, Rocket, cards and internet
 * banking.
 *
 *   1. createCheckout POSTs the session to gwprocess/v4/api.php and returns GatewayPageURL.
 *   2. SSLCommerz sends the payer's browser back with a form POST, and its server calls the IPN URL. Both carry
 *      `tran_id` (our attempt id) and, for a payment, `val_id`.
 *   3. confirm asks the Order Validation API about that val_id with the store's own credentials. Only its answer
 *      (VALID / VALIDATED for our tran_id) counts; the POSTed fields are never trusted.
 *
 * The hosts are constants chosen by the account's mode: no URL here comes from a request or a stored record.
 */
import { outboundRequest } from "@/lib/outbound-http";
import { ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { GatewayMode, SslcommerzCredentials } from "@/types/payments";
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

const HOSTS: Record<GatewayMode, string> = {
  SANDBOX: "https://sandbox.sslcommerz.com",
  LIVE: "https://securepay.sslcommerz.com",
};

/** SSLCommerz accepts 10.00 to 500,000.00 BDT per transaction. */
export const SSLCOMMERZ_MIN_AMOUNT = 10;
export const SSLCOMMERZ_MAX_AMOUNT = 500_000;

const TIMEOUT_MS = 20_000;

function credentials(account: GatewayAccount): SslcommerzCredentials {
  return account.credentials as SslcommerzCredentials;
}

export const sslcommerzAdapter: PaymentGatewayAdapter = {
  provider: "SSLCOMMERZ",

  async createCheckout(account: GatewayAccount, request: GatewayCheckoutRequest): Promise<GatewayCheckoutSession> {
    if (request.amount < SSLCOMMERZ_MIN_AMOUNT || request.amount > SSLCOMMERZ_MAX_AMOUNT) {
      throw new ValidationError(`SSLCommerz takes payments from ৳${SSLCOMMERZ_MIN_AMOUNT} to ৳${SSLCOMMERZ_MAX_AMOUNT.toLocaleString("en-US")}.`, {
        amount: request.amount,
      });
    }
    const { store_id, store_password } = credentials(account);
    const returnUrl = `${request.appBaseUrl}/api/v1/payments/gateway/sslcommerz/return`;
    const form = new URLSearchParams({
      store_id,
      store_passwd: store_password,
      total_amount: formatAmount(request.amount),
      currency: "BDT",
      tran_id: request.attemptId,
      success_url: returnUrl,
      fail_url: returnUrl,
      cancel_url: returnUrl,
      ipn_url: `${request.appBaseUrl}/api/v1/payments/gateway/sslcommerz/ipn`,
      cus_name: request.customer.name.slice(0, 50),
      cus_email: request.customer.email.slice(0, 50),
      cus_add1: (request.customer.address || "N/A").slice(0, 50),
      cus_city: (request.customer.city || "N/A").slice(0, 50),
      cus_postcode: (request.customer.postcode || "0000").slice(0, 30),
      cus_country: "Bangladesh",
      cus_phone: request.customer.phone.slice(0, 20),
      shipping_method: "NO",
      product_name: request.description.slice(0, 255),
      product_category: "general",
      product_profile: "general",
    });

    const response = await outboundRequest(`${HOSTS[account.mode]}/gwprocess/v4/api.php`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      timeoutMs: TIMEOUT_MS,
    });
    const body = parseJsonObject(response.body);
    const redirectUrl = body ? pick(body, "GatewayPageURL") : undefined;
    if (response.status !== 200 || !body || pick(body, "status") !== "SUCCESS" || !redirectUrl) {
      // The reason goes to the log only: it can name the store or quote what was sent.
      logger.warn("payments.sslcommerz.session_refused", {
        http_status: response.status,
        reason: body ? (pick(body, "failedreason") ?? "").slice(0, 160) : "unreadable response",
      });
      throw new PaymentGatewayError("SSLCOMMERZ", "did not open a payment session (check the Store ID and password)");
    }
    return { redirectUrl: assertGatewayRedirect("SSLCOMMERZ", redirectUrl, ["sslcommerz.com"]), gatewayReference: pick(body, "sessionkey") ?? "" };
  },

  async confirm(account: GatewayAccount, attempt: { id: string }, returned: GatewayReturn): Promise<GatewayConfirmation> {
    if (!returned.reference) {
      const claimed = (returned.claimedStatus || "").toUpperCase();
      if (claimed === "CANCELLED") return { status: "CANCELLED", reason: "The payment was cancelled at SSLCommerz." };
      if (claimed === "FAILED") return { status: "FAILED", reason: "SSLCommerz reported a failed payment." };
      return { status: "PENDING", reason: "SSLCommerz sent no validation id." };
    }
    const { store_id, store_password } = credentials(account);
    const query = new URLSearchParams({ val_id: returned.reference, store_id, store_passwd: store_password, format: "json" });
    const response = await outboundRequest(`${HOSTS[account.mode]}/validator/api/validationserverAPI.php?${query.toString()}`, {
      method: "GET",
      timeoutMs: TIMEOUT_MS,
    });
    const body = parseJsonObject(response.body);
    if (response.status !== 200 || !body) {
      throw new PaymentGatewayError("SSLCOMMERZ", "could not be asked about this payment");
    }
    const status = pick(body, "status");
    if (status !== "VALID" && status !== "VALIDATED") {
      return { status: "FAILED", reason: "SSLCommerz does not report a valid payment for this reference." };
    }
    // risk_level 1: SSLCommerz asks the merchant to hold the order and check the payer before treating it as paid.
    if (pick(body, "risk_level") === "1") {
      return { status: "PENDING", reason: "SSLCommerz marked this payment high-risk; check it in the SSLCommerz panel before accepting it." };
    }
    // `amount` is in the settlement currency; `currency_amount` / `currency_type` are what the session asked for.
    const amount = Number(pick(body, "currency_amount", "amount"));
    const currency = pick(body, "currency_type", "currency") ?? "";
    const tranId = pick(body, "tran_id") ?? "";
    if (tranId !== attempt.id) {
      return { status: "FAILED", reason: "SSLCommerz validated a different transaction." };
    }
    // When the answer names a store, it must be the account we asked with (a val_id from another store).
    const answeredStore = pick(body, "store_id");
    if (answeredStore && answeredStore !== store_id) {
      return { status: "FAILED", reason: "SSLCommerz validated a payment of another store." };
    }
    return {
      status: "PAID",
      transactionId: pick(body, "bank_tran_id") ?? returned.reference,
      amount,
      currency,
      attemptId: tranId,
      channel: pick(body, "card_type"),
    };
  },
};
