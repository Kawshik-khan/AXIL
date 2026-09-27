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
    const exceptions = paymentOperationsService.monitorPendingPayments(tenantId);

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

    return apiSuccess(reconciled);
  } catch (err) {
    return apiError(err);
  }
}
