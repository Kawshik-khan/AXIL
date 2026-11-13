import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { PaymentService } from "@/domains/payments/payment.service";
import { withStore } from "@/lib/store-unit";

/** Staff could not find the money for a pending payment: it is marked FAILED (payments.verify; RBAC in the service). */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await extractRequestContext(request);
    const { id } = await params;
    return apiSuccess({ payment: await PaymentService.rejectPayment(context, id) });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
