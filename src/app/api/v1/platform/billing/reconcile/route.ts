import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformBillingService } from "@/domains/platform";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

const Body = z
  .object({
    /** Skip attempts younger than this: their payer may still be on the gateway's page. */
    older_than_minutes: z.number().int().min(5).max(2880).default(15),
  })
  .strict();

/**
 * Asks the gateways about subscription payments that were started but never confirmed (the payer closed the tab and
 * the IPN was lost). A payment settles only on the gateway's own confirmation, exactly as an IPN would settle it.
 */
async function handlePOST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const { older_than_minutes } = parseOrThrow(Body, await readJson(request));
    return apiSuccess({ summary: await PlatformBillingService.reconcileGatewayPayments(context, older_than_minutes) });
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withStore("POST", handlePOST, { unit: false }); // calls the gateways: never under the store lock
