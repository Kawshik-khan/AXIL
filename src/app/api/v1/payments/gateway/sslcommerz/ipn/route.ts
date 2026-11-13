import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { GatewayPaymentService } from "@/domains/payments/gateway-payment.service";
import { NotFoundError } from "@/lib/errors";
import { ATTEMPT_ID_PATTERN } from "@/domains/payments/gateways/gateway.types";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { withStore } from "@/lib/store-unit";

const MAX_BODY_BYTES = 64 * 1024;

/**
 * SSLCommerz's server-to-server notification (IPN). It settles a payment even when the payer never returns to the
 * site. The POSTed fields are a pointer only: the attempt is found by our own `tran_id`, the tenant comes from that
 * attempt, and the payment counts only if SSLCommerz's validation API confirms `val_id` for the same amount.
 */
async function handlePOST(request: Request) {
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) throw new NotFoundError("This payment attempt is not known.");
    const form = new URLSearchParams(raw);
    const attemptId = form.get("tran_id") ?? "";
    if (!ATTEMPT_ID_PATTERN.test(attemptId)) throw new NotFoundError("This payment attempt is not known.");
    await enforceRateLimit(`gateway:confirm:${attemptId}`, 12, MINUTE);
    const outcome = await GatewayPaymentService.complete("SSLCOMMERZ", attemptId, {
      reference: form.get("val_id") || undefined,
      claimedStatus: form.get("status") || undefined,
    });
    return NextResponse.json({ received: true, status: outcome.status });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST, { unit: false }); // calls the gateway: never under the store lock
