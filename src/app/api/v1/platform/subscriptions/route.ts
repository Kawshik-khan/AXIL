import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { db } from "@/infrastructure/db";
import { PlatformSubscriptionService, PlatformAuthorizationService } from "@/domains/platform";

export async function GET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    PlatformAuthorizationService.assertCan(context, "subscription.read");
    const subscriptions = db.getSubscriptions();
    const plans = db.getPlans();
    const planVersions = db.getPlanVersions();

    const enriched = subscriptions.map((s) => {
      const plan = plans.find((p) => p.id === s.plan_id);
      const version = planVersions.find((v) => v.id === s.plan_version_id);
      const tenant = db.findTenantById(s.tenant_id);
      return {
        ...s,
        tenant_name: tenant?.name || "Unknown",
        tenant_slug: tenant?.slug || "",
        plan_name: plan?.name || s.plan_id,
        price_bdt: version?.price_bdt || 0,
      };
    });

    return apiSuccess(enriched);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = await request.json();
    const { tenant_id, plan_id, reason } = body;
    const result = PlatformSubscriptionService.changeTenantPlan(tenant_id, plan_id, reason, context);
    return apiSuccess(result);
  } catch (error) {
    return apiError(error);
  }
}
