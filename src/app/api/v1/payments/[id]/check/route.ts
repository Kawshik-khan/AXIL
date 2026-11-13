import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { TrxLookupService } from "@/domains/payments/trx-lookup.service";
import { withStore } from "@/lib/store-unit";

/**
 * Staff ask bKash again about a pending bKash payment's transaction id (ADR-124), e.g. after bKash was unreachable.
 * Needs payments.verify, like confirming one. Stores the answer (audited in the same unit); confirms only under the
 * platform's auto-confirm rule.
 */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.PAYMENTS_VERIFY);
    const { id } = await params;
    await enforceRateLimit(`payments:trx-check:${context.tenant.id}`, 30, MINUTE);
    const payment = db.findPaymentById(context.tenant.id, id);
    if (!payment) throw new NotFoundError("Payment", id);
    if (payment.provider !== "BKASH" || payment.status !== "PENDING" || !payment.transaction_id) {
      throw new ValidationError("Only a bKash payment waiting for confirmation can be checked with bKash.");
    }
    const checked = await TrxLookupService.check(context.tenant.id, id, { auditActor: context.user.id });
    if (!checked) {
      throw new ValidationError("Save your bKash merchant credentials (bKash checkout, below) to check transaction IDs with bKash.");
    }
    return apiSuccess({ payment: checked.payment, auto_confirmed: checked.autoConfirmed });
  } catch (err) {
    return apiError(err);
  }
}

// Calls bKash: never under the store lock (ADR-110). TrxLookupService.check writes in its own short unit.
export const POST = withStore("POST", handlePOST, { unit: false });
