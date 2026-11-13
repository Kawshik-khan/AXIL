import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { BillingService, InvoiceCreateSchema } from "@/domains/billing/billing.service";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

/** Creates an invoice for one billing period of a plan. The subscription changes only once the invoice is paid. */
async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const input = parseOrThrow(InvoiceCreateSchema, await readJson(request));
    return apiSuccess({ invoice: BillingService.createInvoice(context, input) }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
