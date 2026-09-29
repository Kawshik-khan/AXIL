import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { PaymentService } from "@/domains/payments/payment.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);
    const order_id = searchParams.get("order_id") || undefined;

    const payments = await PaymentService.listPayments(context, order_id);
    return apiSuccess({ payments });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const payment = await PaymentService.createPayment(context, body);
    return apiSuccess({ payment }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
