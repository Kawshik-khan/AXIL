import { AppError } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { paymentOperationsService } from "@/domains/operations/services/payment-operations.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.FINANCE_READ);
    const tenantId = context.tenant.id;

    const payments = db.getPayments(tenantId);
    const exceptions = paymentOperationsService.previewPaymentExceptions(tenantId); // read-only (FX-21)

    return apiSuccess({
      total_payments: payments.length,
      unreconciled_count: exceptions.length,
      exceptions,
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.PAYMENTS_VERIFY);
    const tenantId = context.tenant.id;
    const body = await request.json();

    const reconciled = paymentOperationsService.reconcileTransaction(tenantId, {
      orderId: body.order_id,
      transactionId: body.transaction_id,
      amount: body.amount,
      actor: context.user.id,
    });

    if (!reconciled.matched) {
      // A rejected reconciliation is not a success (non-negotiable 7); the exception record is kept for follow-up.
      throw new AppError("PAYMENT_NOT_RECONCILED", reconciled.error || "The transaction could not be reconciled.", 409);
    }
    return apiSuccess(reconciled);
  } catch (err) {
    return apiError(err);
  }
}
