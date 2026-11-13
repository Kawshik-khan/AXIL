/**
 * Which gateway account pays into whose pocket (rules/platform-billing.md §1: the two never mix).
 *   - storeGatewayAccount: a shop's own merchant account, from its encrypted payment settings. Customer → shop.
 *   - platformGatewayAccount: CommerceOS's merchant account, from the platform environment. Shop → CommerceOS.
 */
import { db } from "@/infrastructure/db";
import { IntegrationNotConfiguredError } from "@/lib/errors";
import { decryptCredential } from "@/lib/security";
import type { BkashCredentials, GatewayCredentials, GatewayMode, GatewayProvider, SslcommerzCredentials } from "@/types/payments";
import { GATEWAY_PROVIDERS } from "@/types/payments";
import { bkashAdapter } from "./bkash.adapter";
import { sslcommerzAdapter } from "./sslcommerz.adapter";
import type { GatewayAccount, PaymentGatewayAdapter } from "./gateway.types";

const ADAPTERS: Record<GatewayProvider, PaymentGatewayAdapter> = {
  SSLCOMMERZ: sslcommerzAdapter,
  BKASH: bkashAdapter,
};

export const GATEWAY_LABELS: Record<GatewayProvider, string> = {
  SSLCOMMERZ: "SSLCommerz",
  BKASH: "bKash",
};

/**
 * A gateway's sandbox moves test money. By default a confirmed sandbox payment is recorded on the attempt only and
 * pays for nothing; PAYMENTS_SANDBOX_SETTLES=1 (demos, development) applies it like a real one, marked test_mode.
 */
export function sandboxSettles(scope: "STORE" | "PLATFORM" = "STORE", env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.PAYMENTS_SANDBOX_SETTLES !== "1") return false;
  // Never for subscription payments in production: test money must not buy a real plan.
  return !(scope === "PLATFORM" && env.NODE_ENV === "production");
}

export function gatewayAdapter(provider: GatewayProvider): PaymentGatewayAdapter {
  return ADAPTERS[provider];
}

export function isGatewayProvider(value: unknown): value is GatewayProvider {
  return typeof value === "string" && (GATEWAY_PROVIDERS as readonly string[]).includes(value);
}

/**
 * The shop's own account for this gateway; refused unless the shop saved credentials and switched it on.
 * `evenIfDisabled`: for confirming a payment that was started before the shop switched the gateway off.
 */
export function storeGatewayAccount(tenantId: string, provider: GatewayProvider, options: { evenIfDisabled?: boolean } = {}): GatewayAccount {
  const config = db.getTenantPaymentSettings(tenantId)?.gateways[provider];
  if (!config || (!config.enabled && !options.evenIfDisabled)) {
    throw new IntegrationNotConfiguredError(`${GATEWAY_LABELS[provider]} checkout`, "this shop has not set it up");
  }
  return { mode: config.mode, credentials: decryptCredential<GatewayCredentials>(config.credentials_encrypted) };
}

/** Gateways a shop's customers can pay through right now. */
export function storeGateways(tenantId: string): GatewayProvider[] {
  const gateways = db.getTenantPaymentSettings(tenantId)?.gateways ?? {};
  return GATEWAY_PROVIDERS.filter((p) => gateways[p]?.enabled === true);
}

function envMode(value: string | undefined): GatewayMode {
  return value?.trim().toLowerCase() === "live" ? "LIVE" : "SANDBOX";
}

function platformCredentials(provider: GatewayProvider, env: NodeJS.ProcessEnv): GatewayAccount | null {
  const read = (name: string) => env[name]?.trim() || "";
  if (provider === "SSLCOMMERZ") {
    const credentials: SslcommerzCredentials = {
      store_id: read("PLATFORM_SSLCOMMERZ_STORE_ID"),
      store_password: read("PLATFORM_SSLCOMMERZ_STORE_PASSWORD"),
    };
    if (!credentials.store_id || !credentials.store_password) return null;
    return { mode: envMode(env.PLATFORM_SSLCOMMERZ_MODE), credentials };
  }
  const credentials: BkashCredentials = {
    app_key: read("PLATFORM_BKASH_APP_KEY"),
    app_secret: read("PLATFORM_BKASH_APP_SECRET"),
    username: read("PLATFORM_BKASH_USERNAME"),
    password: read("PLATFORM_BKASH_PASSWORD"),
  };
  if (!credentials.app_key || !credentials.app_secret || !credentials.username || !credentials.password) return null;
  return { mode: envMode(env.PLATFORM_BKASH_MODE), credentials };
}

/** CommerceOS's own account for subscription payments. */
export function platformGatewayAccount(provider: GatewayProvider, env: NodeJS.ProcessEnv = process.env): GatewayAccount {
  const account = platformCredentials(provider, env);
  if (!account) throw new IntegrationNotConfiguredError(`${GATEWAY_LABELS[provider]} for subscription payments`, "the platform has not set it up");
  return account;
}

/** Gateways a workspace can pay its subscription through right now. */
export function platformGateways(env: NodeJS.ProcessEnv = process.env): GatewayProvider[] {
  return GATEWAY_PROVIDERS.filter((p) => platformCredentials(p, env) !== null);
}

export interface PlatformManualAccounts {
  bkash_number: string | null;
  nagad_number: string | null;
  bank_details: string | null;
}

/** Where a workspace sends a subscription payment by hand; an operator then checks the transaction id. */
export function platformManualAccounts(env: NodeJS.ProcessEnv = process.env): PlatformManualAccounts {
  const read = (name: string) => env[name]?.trim() || null;
  return {
    bkash_number: read("PLATFORM_BILLING_BKASH_NUMBER"),
    nagad_number: read("PLATFORM_BILLING_NAGAD_NUMBER"),
    bank_details: read("PLATFORM_BILLING_BANK_DETAILS"),
  };
}
