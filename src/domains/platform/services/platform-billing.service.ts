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
import { PlatformAuthorizationService } from "./platform-authorization.service";
import { PlatformAuditService } from "./platform-audit.service";
import { PrivilegedActionGate } from "./privileged-action-gate";

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
}
