import { z } from "zod";
import { apiSuccess, apiError } from "@/lib/api-response";
import { GatewayPaymentService } from "@/domains/payments/gateway-payment.service";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { NotFoundError } from "@/lib/errors";
import { ATTEMPT_ID_PATTERN } from "@/domains/payments/gateways/gateway.types";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

const Body = z
  .object({
    attempt_id: z.string().trim().min(1).max(40),
    payment_id: z.string().trim().max(120).optional(),
    status: z.string().trim().max(20).optional(),
  })
  .strict();

/**
 * bKash sends the payer's browser back to /pay/return/bkash/<attempt> with ?paymentID=…&status=…; that page posts
 * them here (a GET must not write). Public by nature and untrusted: a "success" status only means it is time to call
 * bKash's Execute Payment with the merchant's credentials, and only its answer can settle the attempt.
 */
async function handlePOST(request: Request) {
  try {
    const body = parseOrThrow(Body, await readJson(request));
    if (!ATTEMPT_ID_PATTERN.test(body.attempt_id)) throw new NotFoundError("This payment attempt is not known.");
    await enforceRateLimit(`gateway:confirm:${body.attempt_id}`, 12, MINUTE);
    const outcome = await GatewayPaymentService.complete("BKASH", body.attempt_id, {
      reference: body.payment_id || undefined,
      claimedStatus: body.status || undefined,
    });
    return apiSuccess(outcome);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST, { unit: false }); // calls the gateway: never under the store lock
