/**
 * Online payments (ADR-123): gateway settings, payment links, gateway attempts and SaaS billing invoices.
 *
 * Two separate money flows share the gateway adapters and nothing else (rules/platform-billing.md §1):
 *   - STORE: a customer pays a shop. Credentials are the shop's own (TenantPaymentSettingsRecord); the money goes to
 *     the shop's merchant account; the result is a `Payment` on an order.
 *   - PLATFORM: a shop pays CommerceOS for its plan. Credentials come from the platform's environment; the result is
 *     a paid `BillingInvoiceRecord` and an active subscription.
 */

export type GatewayProvider = "SSLCOMMERZ" | "BKASH";
export const GATEWAY_PROVIDERS: readonly GatewayProvider[] = ["SSLCOMMERZ", "BKASH"];

export type GatewayMode = "SANDBOX" | "LIVE";

export interface SslcommerzCredentials {
  store_id: string;
  store_password: string;
}

export interface BkashCredentials {
  app_key: string;
  app_secret: string;
  username: string;
  password: string;
}

export type GatewayCredentials = SslcommerzCredentials | BkashCredentials;

/** One gateway as a shop configured it. The credentials are stored encrypted (encryptCredential) and never returned. */
export interface TenantGatewayConfig {
  enabled: boolean;
  mode: GatewayMode;
  credentials_encrypted: string;
  updated_at: string;
}

export type ManualAccountType = "PERSONAL" | "MERCHANT";

/** Where a customer sends money by hand (Send Money / Payment) before giving the shop the transaction id. */
export interface ManualPaymentAccounts {
  bkash_number?: string;
  bkash_account_type?: ManualAccountType;
  nagad_number?: string;
  nagad_account_type?: ManualAccountType;
  rocket_number?: string;
  /** Shown on the payment page under the numbers, e.g. "Use your order number as the reference". */
  instructions?: string;
}

/** One row per tenant (natural key: tenant_id). */
export interface TenantPaymentSettingsRecord {
  tenant_id: string;
  manual: ManualPaymentAccounts;
  gateways: Partial<Record<GatewayProvider, TenantGatewayConfig>>;
  updated_by: string;
  updated_at: string;
}

export type PaymentLinkStatus = "ACTIVE" | "PAID" | "CANCELLED";

/**
 * A link a shop sends its customer to pay (part of) one order. The token is the only thing the customer holds: it
 * names the tenant and the order server-side, so the public pay routes never take either from the request.
 */
export interface PaymentLinkRecord {
  id: string;
  tenant_id: string;
  order_id: string;
  order_number: string;
  /** 32 random bytes, URL-safe. Shown to staff who may create links (they share the URL), never logged. */
  token: string;
  amount: number;
  currency: "BDT";
  /** What the amount is, e.g. "Advance delivery charge". Written by staff; shown to the customer. */
  note?: string;
  status: PaymentLinkStatus;
  expires_at: string;
  created_by: string;
  created_at: string;
  paid_at?: string;
  /** The Payment row that settled this link. */
  payment_id?: string;
}

export type GatewayAttemptStatus = "INITIATED" | "PAID" | "FAILED" | "CANCELLED";

/**
 * One trip to a gateway's hosted checkout. The id is what the gateway carries as our transaction reference
 * (SSLCommerz `tran_id`, bKash `merchantInvoiceNumber`), so a callback is matched to its attempt, tenant and amount
 * server-side. An attempt becomes PAID only after the gateway itself confirmed the amount to our server.
 */
export interface GatewayPaymentAttemptRecord {
  id: string;
  scope: "STORE" | "PLATFORM";
  tenant_id: string;
  provider: GatewayProvider;
  mode: GatewayMode;
  reference_type: "PAYMENT_LINK" | "BILLING_INVOICE";
  reference_id: string;
  amount: number;
  currency: "BDT";
  status: GatewayAttemptStatus;
  /** bKash paymentId / SSLCommerz sessionkey. */
  gateway_reference?: string;
  /** bKash trxId / SSLCommerz bank_tran_id, once confirmed. */
  gateway_transaction_id?: string;
  failure_reason?: string;
  /**
   * A confirmed SANDBOX payment that was not applied to the order or invoice (the default: test money pays for
   * nothing; PAYMENTS_SANDBOX_SETTLES=1 applies it, marked test_mode).
   */
  test_only?: boolean;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export type BillingInvoiceStatus = "ISSUED" | "PENDING_VERIFICATION" | "PAID" | "VOID";
export type BillingPaymentMethod = "SSLCOMMERZ" | "BKASH" | "MANUAL_BKASH" | "MANUAL_NAGAD" | "MANUAL_BANK";

/**
 * One charge for one billing period of a plan. A subscription changes only when its invoice becomes PAID: by a
 * gateway confirmation, or by a platform operator who checked a manually submitted transaction id.
 */
export interface BillingInvoiceRecord {
  id: string;
  invoice_number: string;
  tenant_id: string;
  plan_id: string;
  plan_version_id: string;
  billing_period: "MONTHLY" | "ANNUAL";
  /** RENEWAL: same plan, the paid period is added after the current one. NEW / PLAN_CHANGE: the period starts when paid. */
  kind: "NEW" | "RENEWAL" | "PLAN_CHANGE";
  plan_price_bdt: number;
  setup_fee_bdt: number;
  amount_bdt: number;
  currency: "BDT";
  status: BillingInvoiceStatus;
  due_date: string;
  /** Set when paid: the period this invoice bought. */
  period_start?: string;
  period_end?: string;
  payment_method?: BillingPaymentMethod;
  /** A transaction id the workspace submitted for a manual transfer; unverified until an operator confirms it. */
  manual_transaction_id?: string;
  manual_submitted_by?: string;
  manual_submitted_at?: string;
  /** Why an operator refused the last manual submission. */
  manual_rejection_reason?: string;
  gateway_attempt_id?: string;
  /** The gateway's own transaction id, or the verified manual one. */
  payment_reference?: string;
  paid_at?: string;
  /** "gateway:<PROVIDER>" or the platform user who verified a manual payment. */
  verified_by?: string;
  /** Paid through a gateway's sandbox: the flow ran, no real money moved. */
  test_mode?: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}
