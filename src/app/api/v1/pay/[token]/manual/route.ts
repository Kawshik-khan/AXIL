import { apiSuccess, apiError } from "@/lib/api-response";
import { ManualSubmissionSchema, PaymentLinkService } from "@/domains/payments/payment-link.service";
import { TrxLookupService } from "@/domains/payments/trx-lookup.service";
import { db } from "@/infrastructure/db";
import { logger } from "@/lib/logger";
import { clientKey, enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

/**
 * Public: a customer who sent money to the shop's number submits the transaction id. It is stored as an unverified,
 * PENDING payment for the shop's staff to check. A bKash id is also looked up with the shop's own bKash merchant
 * account when it has one (ADR-124); the payment is confirmed here only if the platform allows confirming on that.
 * The customer is told PAID or PENDING_VERIFICATION, never what bKash said.
 */
async function handlePOST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    PaymentLinkService.assertTokenShape(token); // before any rate-limit key is built from it
    await enforceRateLimit(`pay-link:manual:${token}`, 5, MINUTE);
    const client = clientKey(request);
    if (client) await enforceRateLimit(`pay-link:manual-client:${client}`, 20, MINUTE);
    const input = parseOrThrow(ManualSubmissionSchema, await readJson(request));
    // 0. Cheap refusals from memory, before any lock or write: a closed link, a used id, a full link (ADR-124)
    const pre = PaymentLinkService.precheckManualSubmission(token, input);
    if (pre.repeat) return apiSuccess({ status: "PENDING_VERIFICATION" }, undefined, 201);
    // One shop's links together: many links can't add up to a flood either
    await enforceRateLimit(`pay-link:manual-shop:${pre.link.tenant_id}`, 30, MINUTE);
    // 1. The submission, in its own short unit of work
    const submitted = await db.unit(() => PaymentLinkService.submitManualPayment(token, input), () => true);
    // 2. The bKash lookup: bKash is called with no store lock held; the result is saved in another short unit
    let status: "PAID" | "PENDING_VERIFICATION" = submitted.status;
    if (submitted.created) {
      try {
        const checked = await TrxLookupService.check(submitted.created.tenant_id, submitted.created.id);
        if (checked?.autoConfirmed) status = "PAID";
      } catch (err) {
        // The submission is saved; staff can check it again
        logger.error("payments.bkash.lookup_unit_failed", { payment_id: submitted.created.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return apiSuccess({ status }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

// Calls bKash: never under the store lock (ADR-110). Each write goes through its own db.unit above.
export const POST = withStore("POST", handlePOST, { unit: false });
