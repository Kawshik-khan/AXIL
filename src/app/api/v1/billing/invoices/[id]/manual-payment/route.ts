import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { BillingService, InvoiceManualPaymentSchema } from "@/domains/billing/billing.service";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

/**
 * The workspace paid its invoice by hand (bKash / Nagad / bank) and submits the transaction id. The invoice waits
 * for a platform operator to check it; the plan does not change here.
 */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await extractRequestContext(request);
    const { id } = await params;
    const input = parseOrThrow(InvoiceManualPaymentSchema, await readJson(request));
    return apiSuccess({ invoice: BillingService.submitManualPayment(context, id, input) });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
