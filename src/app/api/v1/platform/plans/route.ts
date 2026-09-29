import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformSubscriptionService } from "@/domains/platform";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const plans = PlatformSubscriptionService.listPlans(context);
    return apiSuccess(plans);
  } catch (error) {
    return apiError(error);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = await request.json();
    const result = PlatformSubscriptionService.createPlan(body, context);
    return apiSuccess(result, undefined, 201);
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
