import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { BillingService } from "@/domains/billing/billing.service";
import { withStore } from "@/lib/store-unit";

/** Starts this workspace's one self-serve free trial (settings.update). No body: the plan and length are fixed server-side. */
async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    return apiSuccess({ subscription: BillingService.startTrial(context) }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
