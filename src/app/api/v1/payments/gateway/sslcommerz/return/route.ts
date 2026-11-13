import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { GatewayPaymentService } from "@/domains/payments/gateway-payment.service";
import { NotFoundError } from "@/lib/errors";
import { ATTEMPT_ID_PATTERN } from "@/domains/payments/gateways/gateway.types";
import { appBaseUrl } from "@/lib/app-url";
import { logger } from "@/lib/logger";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { withStore } from "@/lib/store-unit";

const MAX_BODY_BYTES = 64 * 1024;

/**
 * SSLCommerz sends the payer's browser here with a form POST after success, failure or cancel. Public by nature, and
 * nothing in the form is trusted: `tran_id` only names our attempt and `val_id` is what we ask SSLCommerz's
 * validation API about with the merchant's own credentials. The browser is then sent to the pay or billing page.
 */
async function handlePOST(request: Request) {
  let attemptId = "";
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) throw new NotFoundError("This payment attempt is not known.");
    const form = new URLSearchParams(raw);
    attemptId = form.get("tran_id") ?? "";
    if (!ATTEMPT_ID_PATTERN.test(attemptId)) throw new NotFoundError("This payment attempt is not known.");
    await enforceRateLimit(`gateway:confirm:${attemptId}`, 12, MINUTE);
    const outcome = await GatewayPaymentService.complete("SSLCOMMERZ", attemptId, {
      reference: form.get("val_id") || undefined,
      claimedStatus: form.get("status") || undefined,
    });
    return redirect(request, outcome.redirect_path);
  } catch (err) {
    // The payer is in a browser: send them back to the page that shows the real state instead of a JSON error.
    const landing = GatewayPaymentService.landing("SSLCOMMERZ", attemptId);
    if (!landing) return apiError(err);
    logger.warn("payments.sslcommerz.return_unconfirmed", { attempt_id: attemptId, error: err instanceof Error ? err.message : String(err) });
    return redirect(request, landing.redirect_path);
  }
}

function redirect(request: Request, path: string): NextResponse {
  // 303: the browser follows with GET. The path is built server-side from our own records.
  return NextResponse.redirect(new URL(path, appBaseUrl() ?? new URL(request.url).origin), 303);
}

export const POST = withStore("POST", handlePOST, { unit: false }); // calls the gateway: never under the store lock
