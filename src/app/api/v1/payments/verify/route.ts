import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { PaymentService } from "@/domains/payments/payment.service";
import { BadRequestError } from "@/lib/errors";
import { withStore } from "@/lib/store-unit";

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    if (!body.payment_id || !body.transaction_id) {
      throw new BadRequestError("payment_id and transaction_id are required.");
    }

    const verified = await PaymentService.verifyPayment(
      context,
      body.payment_id,
      body.transaction_id
    );

    return apiSuccess({ payment: verified });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
