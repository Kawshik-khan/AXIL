import { z } from "zod";
import { apiSuccess, apiError } from "@/lib/api-response";
import { GatewayPaymentService } from "@/domains/payments/gateway-payment.service";
import { PaymentLinkService } from "@/domains/payments/payment-link.service";
import { clientKey, enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

const Body = z.object({ provider: z.enum(["SSLCOMMERZ", "BKASH"]) }).strict();

/**
 * Public: a customer with a payment link starts an online payment through the shop's own gateway account. Returns
 * the gateway's hosted page; the order is touched only after the gateway confirms the payment to our server.
 */
async function handlePOST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    PaymentLinkService.assertTokenShape(token); // before any rate-limit key is built from it
    await enforceRateLimit(`pay-link:checkout:${token}`, 6, MINUTE);
    const client = clientKey(request);
    if (client) await enforceRateLimit(`pay-link:checkout-client:${client}`, 12, MINUTE);
    const { provider } = parseOrThrow(Body, await readJson(request));
    return apiSuccess(await GatewayPaymentService.startLinkCheckout(token, provider));
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST, { unit: false }); // calls the gateway: never under the store lock
