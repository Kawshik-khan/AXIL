import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { BillingService } from "@/domains/billing/billing.service";
import { withStore } from "@/lib/store-unit";

/** This workspace's subscription, the plans it can buy (with their limits), its usage, its invoices and the ways it
 * can pay CommerceOS. */
async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const overview = BillingService.getOverview(context);
    return apiSuccess({ ...overview, usage: await BillingService.getUsage(context) });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
