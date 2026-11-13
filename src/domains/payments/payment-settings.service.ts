/**
 * How a shop gets paid by its customers (ADR-123): the numbers customers send money to by hand, and the shop's own
 * SSLCommerz / bKash merchant credentials for online checkout. Credentials are stored encrypted and never returned;
 * the page shows only whether they exist and a masked identifier.
 */
import { z } from "zod";
import { db } from "@/infrastructure/db";
import type { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { ValidationError } from "@/lib/errors";
import { decryptCredential, encryptCredential, maskSecret } from "@/lib/security";
import { newId } from "@/lib/ids";
import type {
  BkashCredentials,
  GatewayMode,
  GatewayProvider,
  ManualPaymentAccounts,
  SslcommerzCredentials,
  TenantGatewayConfig,
  TenantPaymentSettingsRecord,
} from "@/types/payments";
import { GATEWAY_PROVIDERS } from "@/types/payments";
import { sandboxSettles } from "./gateways/gateway-accounts";

/** A Bangladeshi mobile wallet number: 01XXXXXXXXX. */
const walletNumber = z.string().trim().regex(/^01[3-9]\d{8}$/, "Enter an 11-digit number starting with 01.");
const optionalWallet = z.union([walletNumber, z.literal("")]).optional();
const accountType = z.enum(["PERSONAL", "MERCHANT"]);
const secret = z.string().trim().min(1).max(200);

const ManualSchema = z
  .object({
    bkash_number: optionalWallet,
    bkash_account_type: accountType.optional(),
    nagad_number: optionalWallet,
    nagad_account_type: accountType.optional(),
    rocket_number: z.union([z.string().trim().regex(/^01[3-9]\d{8,9}$/, "Enter a Rocket number starting with 01."), z.literal("")]).optional(),
    instructions: z.string().trim().max(500).optional(),
  })
  .strict();

const gatewaySchema = <C extends z.ZodTypeAny>(credentials: C) =>
  z
    .object({
      enabled: z.boolean(),
      mode: z.enum(["SANDBOX", "LIVE"]),
      /** Left out: keep the saved credentials. */
      credentials: credentials.optional(),
    })
    .strict();

export const PaymentSettingsUpdateSchema = z
  .object({
    manual: ManualSchema.optional(),
    gateways: z
      .object({
        SSLCOMMERZ: gatewaySchema(z.object({ store_id: secret, store_password: secret }).strict()).nullable().optional(),
        BKASH: gatewaySchema(z.object({ app_key: secret, app_secret: secret, username: secret, password: secret }).strict())
          .nullable()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type PaymentSettingsUpdate = z.infer<typeof PaymentSettingsUpdateSchema>;

export interface GatewaySettingsView {
  configured: boolean;
  enabled: boolean;
  mode: GatewayMode | null;
  /** The account's public identifier, masked (SSLCommerz Store ID / bKash username). Never a password or secret. */
  account_hint: string | null;
  updated_at: string | null;
}

export interface PaymentSettingsView {
  manual: ManualPaymentAccounts;
  gateways: Record<GatewayProvider, GatewaySettingsView>;
  /** Whether this installation applies confirmed sandbox payments to orders (PAYMENTS_SANDBOX_SETTLES=1: demos). */
  sandbox_settles: boolean;
  updated_at: string | null;
}

function accountHint(provider: GatewayProvider, config: TenantGatewayConfig): string | null {
  try {
    if (provider === "SSLCOMMERZ") return maskSecret(decryptCredential<SslcommerzCredentials>(config.credentials_encrypted).store_id);
    return maskSecret(decryptCredential<BkashCredentials>(config.credentials_encrypted).username);
  } catch {
    return null;
  }
}

function view(record: TenantPaymentSettingsRecord | undefined): PaymentSettingsView {
  const gateways = {} as Record<GatewayProvider, GatewaySettingsView>;
  for (const provider of GATEWAY_PROVIDERS) {
    const config = record?.gateways[provider];
    gateways[provider] = config
      ? { configured: true, enabled: config.enabled, mode: config.mode, account_hint: accountHint(provider, config), updated_at: config.updated_at }
      : { configured: false, enabled: false, mode: null, account_hint: null, updated_at: null };
  }
  return { manual: record?.manual ?? {}, gateways, sandbox_settles: sandboxSettles("STORE"), updated_at: record?.updated_at ?? null };
}

function cleanManual(input: z.infer<typeof ManualSchema>): ManualPaymentAccounts {
  const manual: ManualPaymentAccounts = {};
  if (input.bkash_number) {
    manual.bkash_number = input.bkash_number;
    manual.bkash_account_type = input.bkash_account_type ?? "PERSONAL";
  }
  if (input.nagad_number) {
    manual.nagad_number = input.nagad_number;
    manual.nagad_account_type = input.nagad_account_type ?? "PERSONAL";
  }
  if (input.rocket_number) manual.rocket_number = input.rocket_number;
  if (input.instructions) manual.instructions = input.instructions;
  return manual;
}

export class PaymentSettingsService {
  public static get(context: RequestContext): PaymentSettingsView {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_READ);
    return view(db.getTenantPaymentSettings(context.tenant.id));
  }

  /**
   * `manual`, when given, replaces the manual accounts. Each gateway given is replaced (null removes it); a gateway
   * left out is untouched. Credentials left out keep the saved ones.
   */
  public static update(context: RequestContext, input: PaymentSettingsUpdate): PaymentSettingsView {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);
    const existing = db.getTenantPaymentSettings(context.tenant.id);
    const now = new Date().toISOString();
    const gateways: TenantPaymentSettingsRecord["gateways"] = { ...(existing?.gateways ?? {}) };
    const changed: string[] = [];

    for (const provider of GATEWAY_PROVIDERS) {
      const next = input.gateways?.[provider];
      if (next === undefined) continue;
      if (next === null) {
        if (gateways[provider]) changed.push(`${provider}:removed`);
        delete gateways[provider];
        continue;
      }
      const saved = gateways[provider];
      if (!next.credentials && !saved) {
        throw new ValidationError(`Enter the ${provider === "BKASH" ? "bKash" : "SSLCommerz"} credentials before saving it.`);
      }
      gateways[provider] = {
        enabled: next.enabled,
        mode: next.mode,
        credentials_encrypted: next.credentials ? encryptCredential(next.credentials) : saved!.credentials_encrypted,
        updated_at: now,
      };
      changed.push(`${provider}:${next.enabled ? "enabled" : "disabled"}:${next.mode}${next.credentials ? ":credentials" : ""}`);
    }

    const manual = input.manual ? cleanManual(input.manual) : existing?.manual ?? {};
    if (input.manual) changed.push("manual_accounts");

    const record: TenantPaymentSettingsRecord = {
      tenant_id: context.tenant.id,
      manual,
      gateways,
      updated_by: context.user.id,
      updated_at: now,
    };
    db.saveTenantPaymentSettings(record);

    // Where the shop's money goes changed: record who did it, with the numbers but never a credential.
    db.createAuditLog({
      id: newId("aud"),
      tenant_id: context.tenant.id,
      actor_user_id: context.user.id,
      action: "PAYMENT_SETTINGS_UPDATED",
      resource_type: "payment_settings",
      resource_id: context.tenant.id,
      metadata: {
        changed,
        ...(input.manual
          ? {
              bkash_number: manual.bkash_number ?? null,
              nagad_number: manual.nagad_number ?? null,
              rocket_number: manual.rocket_number ?? null,
              previous_bkash_number: existing?.manual.bkash_number ?? null,
              previous_nagad_number: existing?.manual.nagad_number ?? null,
              previous_rocket_number: existing?.manual.rocket_number ?? null,
            }
          : {}),
      },
      created_at: now,
    });
    return view(record);
  }
}
