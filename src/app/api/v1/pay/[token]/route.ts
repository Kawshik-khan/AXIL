import { apiSuccess, apiError } from "@/lib/api-response";
import { PaymentLinkService } from "@/domains/payments/payment-link.service";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { withStore } from "@/lib/store-unit";

/**
 * Public: what a customer sees on a shop's payment link. No session: the token in the path is the credential, and
 * it alone names the shop and the order. Shows the shop, the order number, the amount and how to pay; no personal data.
 */
async function handleGET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    PaymentLinkService.assertTokenShape(token); // before any rate-limit key is built from it
    await enforceRateLimit(`pay-link:view:${token}`, 120, MINUTE);
    return apiSuccess({ link: PaymentLinkService.publicView(token) });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
