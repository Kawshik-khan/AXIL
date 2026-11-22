/**
 * Platform side of subscription billing (ADR-123): operators see every workspace's invoices and decide on payments
 * sent by hand. Confirming one is what applies the plan, so it goes through the privileged-action gate (billing.manage
 * + a written reason) and the platform audit ledger. Gateway payments settle by themselves (GatewayPaymentService).
 */
import { db } from "@/infrastructure/db";
import type { PlatformContext } from "@/lib/context";
import { AppError, NotFoundError } from "@/lib/errors";
import type { BillingInvoiceRecord, BillingInvoiceStatus } from "@/types/payments";
import { BillingService } from "@/domains/billing/billing.service";
import { GatewayPaymentService, type ReconcileSummary } from "@/domains/payments/gateway-payment.service";
import { PlatformAuthorizationService } from "./platform-authorization.service";
import { PlatformAuditService } from "./platform-audit.service";
import { PrivilegedActionGate } from "./privileged-action-gate";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";

/** Reconcile runs per minute, platform-wide: a run can take a minute of gateway calls, so no stacked runs. */
export const RECONCILE_RUNS_PER_MINUTE = 3;

export interface PlatformInvoiceView extends BillingInvoiceRecord {
  tenant_name: string | null;
  tenant_slug: string | null;
  plan_name: string | null;
}

function pendingInvoice(invoiceId: string): BillingInvoiceRecord {
  const invoice = db.findBillingInvoiceForPlatform(invoiceId);
  if (!invoice) throw new NotFoundError(`Invoice "${invoiceId}" not found.`);
  if (invoice.status !== "PENDING_VERIFICATION" || !invoice.manual_transaction_id || !invoice.payment_method) {
    throw new AppError("INVOICE_NOT_PENDING", "This invoice has no submitted payment waiting to be checked.", 409, { status: invoice.status });
  }
  return invoice;
}

export class PlatformBillingService {
  public static listInvoices(context: PlatformContext, filter: { status?: BillingInvoiceStatus } = {}): PlatformInvoiceView[] {
    PlatformAuthorizationService.assertCan(context, "billing.read");
    const plans = db.getPlans();
    return db
      .getAllBillingInvoices()
      .filter((i) => !filter.status || i.status === filter.status)
      .map((invoice) => {
        const tenant = db.findTenantById(invoice.tenant_id);
        return {
          ...invoice,
          tenant_name: tenant?.name ?? null,
          tenant_slug: tenant?.slug ?? null,
          plan_name: plans.find((p) => p.id === invoice.plan_id)?.name ?? null,
        };
      });
  }

  /** The operator checked the transfer in the platform's own bKash / Nagad / bank statement: the invoice is paid. */
  public static verifyManualPayment(context: PlatformContext, invoiceId: string, reason: string): BillingInvoiceRecord {
    PrivilegedActionGate.assert(context, "billing.verify_payment", { reason, payload: { invoice_id: invoiceId } });
    const invoice = pendingInvoice(invoiceId);
    const before = db.findSubscriptionByTenantId(invoice.tenant_id);
    const paid = BillingService.settle(invoice, {
      method: invoice.payment_method!,
      reference: invoice.manual_transaction_id!,
      verifiedBy: context.platformUser.id,
    });
    const after = db.findSubscriptionByTenantId(invoice.tenant_id);
    PlatformAuditService.record(
      {
        action: "billing.verify_payment",
        resource_type: "billing_invoice",
        resource_id: invoice.id,
        target_tenant_id: invoice.tenant_id,
        reason: reason.trim(),
        before_state: {
          invoice_status: invoice.status,
          subscription_status: before?.status ?? null,
          plan_id: before?.plan_id ?? null,
          current_period_end: before?.current_period_end ?? null,
        },
        after_state: {
          invoice_status: paid.status,
          invoice_number: paid.invoice_number,
          amount_bdt: paid.amount_bdt,
          method: paid.payment_method ?? null,
          subscription_status: after?.status ?? null,
          plan_id: after?.plan_id ?? null,
          current_period_end: after?.current_period_end ?? null,
        },
        result: "SUCCESS",
      },
      context
    );
    return paid;
  }

  /** The transfer could not be found: the invoice goes back to payable and the workspace sees why. */
  public static rejectManualPayment(context: PlatformContext, invoiceId: string, reason: string): BillingInvoiceRecord {
    PrivilegedActionGate.assert(context, "billing.reject_payment", { reason, payload: { invoice_id: invoiceId } });
    const invoice = pendingInvoice(invoiceId);
    const rejected: BillingInvoiceRecord = {
      ...invoice,
      status: "ISSUED",
      manual_transaction_id: undefined,
      manual_submitted_by: undefined,
      manual_submitted_at: undefined,
      payment_method: undefined,
      manual_rejection_reason: reason.trim().slice(0, 300),
      updated_at: new Date().toISOString(),
    };
    db.saveBillingInvoice(rejected);
    PlatformAuditService.record(
      {
        action: "billing.reject_payment",
        resource_type: "billing_invoice",
        resource_id: invoice.id,
        target_tenant_id: invoice.tenant_id,
        reason: reason.trim(),
        before_state: { invoice_status: invoice.status, method: invoice.payment_method ?? null },
        after_state: { invoice_status: rejected.status, invoice_number: rejected.invoice_number },
        result: "SUCCESS",
      },
      context
    );
    return rejected;
  }

  /**
   * Asks the gateways again about subscription payments that were started and never confirmed (lost IPN, payer never
   * came back). It decides nothing itself: a payment settles only when the gateway confirms it, through the same path
   * as an IPN (risk LOW, no reason or approval). Runs outside the store lock (gateway calls). Audited as one run row
   * plus one row per settled invoice naming its tenant, since settling changes that workspace's plan.
   */
  public static async reconcileGatewayPayments(context: PlatformContext, olderThanMinutes: number): Promise<ReconcileSummary> {
    PrivilegedActionGate.assert(context, "billing.reconcile_gateway_payments", { reason: "", payload: { older_than_minutes: olderThanMinutes } });
    await enforceRateLimit("platform:billing:reconcile", RECONCILE_RUNS_PER_MINUTE, MINUTE);
    const summary = await GatewayPaymentService.reconcilePlatformAttempts(olderThanMinutes);
    await db.unit(async () => {
      const { settled, ...counts } = summary;
      const run = PlatformAuditService.record(
        {
          action: "billing.reconcile_gateway_payments",
          resource_type: "billing_invoice",
          resource_id: "gateway_attempts",
          reason: `Asked the gateways about unconfirmed subscription payments older than ${olderThanMinutes} minutes.`,
          after_state: { older_than_minutes: olderThanMinutes, ...counts, settled },
          result: summary.errors > 0 ? "FAILED" : "SUCCESS",
        },
        context
      );
      for (const item of settled) {
        PlatformAuditService.record(
          {
            action: "billing.reconcile_gateway_payments",
            resource_type: "billing_invoice",
            resource_id: item.invoice_id,
            target_tenant_id: item.tenant_id,
            reason: "The gateway confirmed this payment when asked by a reconcile run.",
            after_state: { invoice_status: db.findBillingInvoiceById(item.tenant_id, item.invoice_id)?.status ?? null, gateway_attempt_id: item.attempt_id, run_audit_id: run.id },
            result: "SUCCESS",
          },
          context
        );
      }
    }, () => true);
    return summary;
  }
}
