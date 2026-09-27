import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { PaymentService } from "@/domains/payments/payment.service";

export async function GET(request: Request) {
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

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const payment = await PaymentService.createPayment(context, body);
    return apiSuccess({ payment }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
