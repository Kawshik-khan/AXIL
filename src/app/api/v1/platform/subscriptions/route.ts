import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { db } from "@/infrastructure/db";
import { PlatformAuthorizationService } from "@/domains/platform";
import { mrrContribution, subscriptionPeriod } from "@/domains/platform/plan-pricing";
import { withStore } from "@/lib/store-unit";

/**
 * Every subscription with its tenant, plan and what it contributes to MRR (annual / 12). Changes go through
 * /api/v1/platform/tenants/[id]/subscription.
 */
async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    PlatformAuthorizationService.assertCan(context, "subscription.read");
    const plans = db.getPlans();
    const planVersions = db.getPlanVersions();

    const enriched = db.getSubscriptions().map((s) => {
      const plan = plans.find((p) => p.id === s.plan_id);
      const version = planVersions.find((v) => v.id === s.plan_version_id);
      const tenant = db.findTenantById(s.tenant_id);
      return {
        ...s,
        tenant_name: tenant?.name ?? null,
        tenant_slug: tenant?.slug ?? null,
        plan_name: plan?.name ?? null,
        plan_version: version?.version ?? null,
        billing_period: version ? subscriptionPeriod(s, version) : s.billing_period ?? null,
        mrr_bdt: version && s.status === "ACTIVE" ? Math.round(mrrContribution(s, version)) : 0,
      };
    });

    return apiSuccess(enriched);
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
