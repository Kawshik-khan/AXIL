/**
 * Workspace subscription billing (ADR-123): a workspace picks a plan, gets an invoice for one billing period, and
 * pays it. The subscription changes only when the invoice becomes PAID:
 *   - online, after the platform's own gateway account confirmed the amount (GatewayPaymentService), or
 *   - by hand: the workspace sends money to the platform's number and submits the transaction id; a platform operator
 *     checks it and verifies the invoice (PlatformBillingService).
 * Nothing renews by itself: there is no auto-debit. Store payments (customer → shop) never pass through here
 * (rules/platform-billing.md §1).
 */
import { z } from "zod";
import crypto from "crypto";
import { db } from "@/infrastructure/db";
import type { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { logger } from "@/lib/logger";
import type { PlanRecord, PlanVersionRecord, SubscriptionRecord } from "@/types/platform";
import type { BillingInvoiceRecord, BillingPaymentMethod, GatewayProvider } from "@/types/payments";
import { annualPrice, latestPublished, monthlyPrice } from "@/domains/platform/plan-pricing";
import { ENTITLEMENT_CATALOG, type EntitlementKind, type EntitlementValue } from "@/domains/platform/entitlement-catalog";
import { PlatformEntitlementService } from "@/domains/platform/services/platform-entitlement.service";
import { periodEnd } from "@/domains/platform/services/platform-subscription.service";
import { platformGateways, platformManualAccounts, type PlatformManualAccounts } from "@/domains/payments/gateways/gateway-accounts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Days an issued invoice stays payable before its due date passes. Business config lives in code (non-negotiable 6). */
export const INVOICE_DUE_DAYS = 7;

export const InvoiceCreateSchema = z
  .object({
    plan_id: z.string().trim().min(1).max(60),
    billing_period: z.enum(["MONTHLY", "ANNUAL"]),
  })
  .strict();

export const InvoiceManualPaymentSchema = z
  .object({
    method: z.enum(["MANUAL_BKASH", "MANUAL_NAGAD", "MANUAL_BANK"]),
    transaction_id: z.string().trim().min(6).max(40),
  })
  .strict();

export interface BillingPlanOption {
  id: string;
  name: string;
  description: string;
  highlight_label: string | null;
  plan_version_id: string;
  monthly_price_bdt: number | null;
  annual_price_bdt: number | null;
  setup_fee_bdt: number;
  is_current: boolean;
  /** What the plan allows, for every limit the platform enforces (number = cap, null = unlimited, boolean = feature). */
  limits: PlanLimit[];
}

export interface PlanLimit {
  id: string;
  label: string;
  unit?: string;
  kind: EntitlementKind;
  value: EntitlementValue;
}

/** One enforced limit as it applies to this workspace now (plan, add-ons and any override included), and its use. */
export interface WorkspaceUsage extends PlanLimit {
  /** Current count or this month's use; null for on/off features. */
  used: number | null;
}

/** Only limits some code enforces are shown: a limit nobody checks would be a promise the product doesn't keep. */
const ENFORCED = ENTITLEMENT_CATALOG.filter((spec) => spec.enforcedBy !== null);

const isLimitValue = (v: unknown): v is EntitlementValue => v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));

/** The plan version's value, else the platform default, else unlimited: the same order the entitlement gate uses. */
function planLimits(version: PlanVersionRecord): PlanLimit[] {
  const features = version.features ?? {};
  return ENFORCED.map((spec) => {
    let value: EntitlementValue = null;
    if (Object.hasOwn(features, spec.id) && isLimitValue(features[spec.id])) {
      value = features[spec.id] as EntitlementValue;
    } else {
      const fallback = db.findEntitlementById(spec.id);
      if (fallback) value = fallback.value_type === "BOOLEAN" ? Boolean(fallback.default_value) : Number(fallback.default_value) || 0;
    }
    return { id: spec.id, label: spec.label, unit: spec.unit, kind: spec.kind, value };
  });
}

export interface BillingOverview {
  subscription:
    | (Pick<SubscriptionRecord, "status" | "plan_id" | "billing_period" | "trial_ends_at" | "current_period_start" | "current_period_end"> & {
        plan_name: string | null;
      })
    | null;
  plans: BillingPlanOption[];
  invoices: BillingInvoiceRecord[];
  payment_options: { gateways: GatewayProvider[]; manual: PlatformManualAccounts };
}

function offeredTo(plan: PlanRecord, tenantId: string): boolean {
  if (!plan.is_active) return false;
  const visibility = plan.visibility ?? "PUBLIC";
  if (visibility === "PUBLIC") return true;
  return visibility === "PRIVATE" && (plan.private_tenant_ids ?? []).includes(tenantId);
}

function priceFor(version: PlanVersionRecord, period: "MONTHLY" | "ANNUAL"): number | null {
  return period === "ANNUAL" ? annualPrice(version) : monthlyPrice(version);
}

function invoiceNumber(now: Date): string {
  const month = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `INV-${month}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function normalizeReference(value: string): string {
  return value.trim().toUpperCase();
}

export class BillingService {
  public static getOverview(context: RequestContext): BillingOverview {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_READ);
    const tenantId = context.tenant.id;
    const subscription = db.findSubscriptionByTenantId(tenantId);
    const plans: BillingPlanOption[] = db
      .getPlans()
      .filter((plan) => offeredTo(plan, tenantId))
      .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
      .flatMap((plan) => {
        const version = latestPublished(db.getPlanVersions(plan.id));
        if (!version) return [];
        return [
          {
            id: plan.id,
            name: plan.name,
            description: plan.description,
            highlight_label: plan.highlight_label ?? null,
            plan_version_id: version.id,
            monthly_price_bdt: monthlyPrice(version),
            annual_price_bdt: annualPrice(version),
            setup_fee_bdt: version.setup_fee_bdt ?? 0,
            is_current: subscription?.plan_id === plan.id,
            limits: planLimits(version),
          },
        ];
      });
    return {
      subscription: subscription
        ? {
            status: subscription.status,
            plan_id: subscription.plan_id,
            billing_period: subscription.billing_period,
            trial_ends_at: subscription.trial_ends_at,
            current_period_start: subscription.current_period_start,
            current_period_end: subscription.current_period_end,
            plan_name: db.findPlanById(subscription.plan_id)?.name ?? null,
          }
        : null,
      plans,
      invoices: db.getBillingInvoices(tenantId),
      payment_options: { gateways: platformGateways(), manual: platformManualAccounts() },
    };
  }

  /**
   * This workspace's enforced limits as they apply now and how much of each it uses. Read-only; operator-only details
   * (who granted an override, tickets) are left out.
   */
  public static async getUsage(context: RequestContext): Promise<WorkspaceUsage[]> {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_READ);
    const tenantId = context.tenant.id;
    return Promise.all(
      ENFORCED.map(async (spec) => ({
        id: spec.id,
        label: spec.label,
        unit: spec.unit,
        kind: spec.kind,
        value: PlatformEntitlementService.resolve(tenantId, spec.id).value,
        used: spec.kind === "FEATURE" ? null : await PlatformEntitlementService.measureUsage(tenantId, spec.id),
      })),
    );
  }

  /**
   * An invoice for one period of a plan this workspace is offered. An unpaid invoice it replaces is voided; one whose
   * payment an operator is checking blocks a new one.
   */
  public static createInvoice(context: RequestContext, input: z.infer<typeof InvoiceCreateSchema>): BillingInvoiceRecord {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);
    const tenantId = context.tenant.id;
    const plan = db.findPlanById(input.plan_id);
    if (!plan || !offeredTo(plan, tenantId)) throw new NotFoundError("Plan", input.plan_id);
    const version = latestPublished(db.getPlanVersions(plan.id));
    if (!version) throw new AppError("PLAN_NOT_PUBLISHED", `Plan "${plan.name}" can't be bought yet.`, 409);
    const price = priceFor(version, input.billing_period);
    if (price === null) {
      throw new AppError("PERIOD_NOT_OFFERED", `Plan "${plan.name}" is not sold ${input.billing_period === "ANNUAL" ? "yearly" : "monthly"}.`, 400);
    }
    if (!(price > 0)) {
      throw new ValidationError(`Plan "${plan.name}" is free: there is nothing to pay. Contact support to switch to it.`);
    }

    const existing = db.getBillingInvoices(tenantId);
    if (existing.some((i) => i.status === "PENDING_VERIFICATION")) {
      throw new ConflictError("A payment you submitted is still being checked. Wait for it to be confirmed before starting another invoice.");
    }
    const now = new Date();
    for (const open of existing.filter((i) => i.status === "ISSUED")) {
      db.saveBillingInvoice({ ...open, status: "VOID", updated_at: now.toISOString() });
    }

    const subscription = db.findSubscriptionByTenantId(tenantId);
    const samePlan = subscription?.plan_id === plan.id;
    const kind: BillingInvoiceRecord["kind"] = !subscription
      ? "NEW"
      : samePlan
        ? subscription.status === "ACTIVE" || subscription.status === "PAST_DUE"
          ? "RENEWAL"
          : "NEW"
        : "PLAN_CHANGE";
    // The setup fee is charged once: with the first invoice a workspace ever pays.
    const setupFee = existing.some((i) => i.status === "PAID") ? 0 : Math.max(0, version.setup_fee_bdt ?? 0);

    const invoice: BillingInvoiceRecord = {
      id: newId("binv"),
      invoice_number: invoiceNumber(now),
      tenant_id: tenantId,
      plan_id: plan.id,
      plan_version_id: version.id,
      billing_period: input.billing_period,
      kind,
      plan_price_bdt: price,
      setup_fee_bdt: setupFee,
      amount_bdt: Math.round((price + setupFee) * 100) / 100,
      currency: "BDT",
      status: "ISSUED",
      due_date: new Date(now.getTime() + INVOICE_DUE_DAYS * DAY_MS).toISOString(),
      created_by: context.user.id,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
    db.saveBillingInvoice(invoice);
    db.createAuditLog({
      id: newId("aud"),
      tenant_id: tenantId,
      actor_user_id: context.user.id,
      action: "BILLING_INVOICE_CREATED",
      resource_type: "billing_invoice",
      resource_id: invoice.id,
      metadata: { invoice_number: invoice.invoice_number, plan_id: plan.id, billing_period: input.billing_period, amount_bdt: invoice.amount_bdt, kind },
      created_at: now.toISOString(),
    });
    return invoice;
  }

  /** The workspace's own invoice, still payable. */
  public static payableInvoice(context: RequestContext, invoiceId: string): BillingInvoiceRecord {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);
    const invoice = db.findBillingInvoiceById(context.tenant.id, invoiceId);
    if (!invoice) throw new NotFoundError("Invoice", invoiceId);
    if (invoice.status === "PAID") throw new ConflictError("This invoice is already paid.");
    if (invoice.status === "VOID") throw new ConflictError("This invoice was replaced. Pay the newer one.");
    if (invoice.status === "PENDING_VERIFICATION") throw new ConflictError("A payment for this invoice is already being checked.");
    // Prices and plans change: an invoice is payable until its due date, then a new one is needed.
    if (Date.parse(invoice.due_date) < Date.now()) throw new ConflictError("This invoice is past its due date. Choose the plan again to get a new one.");
    return invoice;
  }

  /**
   * The workspace sent the money by hand and gives the transaction id. The invoice waits for a platform operator;
   * the subscription does not change here.
   */
  public static submitManualPayment(
    context: RequestContext,
    invoiceId: string,
    input: z.infer<typeof InvoiceManualPaymentSchema>
  ): BillingInvoiceRecord {
    const invoice = this.payableInvoice(context, invoiceId);
    const accounts = platformManualAccounts();
    const configured = { MANUAL_BKASH: accounts.bkash_number, MANUAL_NAGAD: accounts.nagad_number, MANUAL_BANK: accounts.bank_details }[input.method];
    if (!configured) throw new ValidationError("That payment method is not available.");

    const reference = normalizeReference(input.transaction_id);
    if (!/^[A-Z0-9-]{6,40}$/.test(reference)) throw new ValidationError("The transaction ID should be 6 to 40 letters or digits.");
    // One transfer pays one invoice, whichever workspace submits it.
    const reused = db
      .getAllBillingInvoices()
      .some((i) => i.id !== invoice.id && (i.manual_transaction_id === reference || i.payment_reference === reference));
    if (reused) throw new ConflictError("This transaction ID has already been used for another invoice.");

    const now = new Date().toISOString();
    const updated: BillingInvoiceRecord = {
      ...invoice,
      status: "PENDING_VERIFICATION",
      payment_method: input.method,
      manual_transaction_id: reference,
      manual_submitted_by: context.user.id,
      manual_submitted_at: now,
      manual_rejection_reason: undefined,
      updated_at: now,
    };
    db.saveBillingInvoice(updated);
    db.createAuditLog({
      id: newId("aud"),
      tenant_id: context.tenant.id,
      actor_user_id: context.user.id,
      action: "BILLING_PAYMENT_SUBMITTED",
      resource_type: "billing_invoice",
      resource_id: invoice.id,
      metadata: { invoice_number: invoice.invoice_number, method: input.method, amount_bdt: invoice.amount_bdt },
      created_at: now,
    });
    return updated;
  }

  /**
   * Records a confirmed payment and applies the plan. Called only after the money is confirmed: by the platform's
   * gateway account, or by an operator who checked a manual transfer. A renewal paid before the current period ends
   * is added after it; anything else starts now.
   */
  public static settle(
    invoice: BillingInvoiceRecord,
    payment: { method: BillingPaymentMethod; reference: string; verifiedBy: string; gatewayAttemptId?: string; testMode?: boolean }
  ): BillingInvoiceRecord {
    if (invoice.status === "PAID") return invoice;
    if (invoice.status === "VOID") {
      // Money arrived for an invoice the workspace had replaced: it was still paid, so it still counts.
      logger.warn("billing.void_invoice_paid", { tenant_id: invoice.tenant_id, invoice_id: invoice.id });
    }
    const tenantId = invoice.tenant_id;
    const now = new Date();
    const subscription = db.findSubscriptionByTenantId(tenantId);
    const extendsCurrent =
      invoice.kind === "RENEWAL" &&
      subscription !== undefined &&
      subscription.plan_id === invoice.plan_id &&
      (subscription.status === "ACTIVE" || subscription.status === "PAST_DUE") &&
      Date.parse(subscription.current_period_end) > now.getTime();
    const start = extendsCurrent ? new Date(subscription!.current_period_end) : now;
    const end = periodEnd(start, invoice.billing_period);

    // Built field by field: a paid subscription carries no trial end.
    const updatedSubscription: SubscriptionRecord = {
      id: subscription?.id ?? `sub_${crypto.randomUUID().substring(0, 12)}`,
      tenant_id: tenantId,
      plan_id: invoice.plan_id,
      plan_version_id: invoice.plan_version_id,
      status: "ACTIVE",
      billing_period: invoice.billing_period,
      current_period_start: extendsCurrent ? subscription!.current_period_start : start.toISOString(),
      current_period_end: end.toISOString(),
      cancel_at_period_end: false,
      created_at: subscription?.created_at ?? now.toISOString(),
      updated_at: now.toISOString(),
    };
    db.saveSubscription(updatedSubscription);
    db.updateTenant(tenantId, { plan_id: invoice.plan_id, updated_at: now.toISOString() });

    const paid: BillingInvoiceRecord = {
      ...invoice,
      status: "PAID",
      payment_method: payment.method,
      payment_reference: normalizeReference(payment.reference),
      verified_by: payment.verifiedBy,
      ...(payment.gatewayAttemptId ? { gateway_attempt_id: payment.gatewayAttemptId } : {}),
      ...(payment.testMode ? { test_mode: true } : {}),
      period_start: start.toISOString(),
      period_end: end.toISOString(),
      paid_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
    db.saveBillingInvoice(paid);
    // Any other unpaid invoice of this workspace is now out of date.
    for (const other of db.getBillingInvoices(tenantId)) {
      if (other.id !== paid.id && other.status === "ISSUED") db.saveBillingInvoice({ ...other, status: "VOID", updated_at: now.toISOString() });
    }
    db.createAuditLog({
      id: newId("aud"),
      tenant_id: tenantId,
      actor_user_id: payment.verifiedBy,
      action: "BILLING_INVOICE_PAID",
      resource_type: "billing_invoice",
      resource_id: paid.id,
      metadata: {
        invoice_number: paid.invoice_number,
        plan_id: paid.plan_id,
        billing_period: paid.billing_period,
        amount_bdt: paid.amount_bdt,
        method: payment.method,
        period_start: paid.period_start,
        period_end: paid.period_end,
      },
      created_at: now.toISOString(),
    });
    return paid;
  }
}
