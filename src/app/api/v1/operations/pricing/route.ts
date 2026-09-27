import { randomSuffix } from "@/lib/ids";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { pricingOperationsService } from "@/domains/operations/services/pricing-operations.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.PRICING_READ);
    const tenantId = context.tenant.id;

    const rules = db.getPricingRules(tenantId);
    const executions = db.getPriceChangeExecutions(tenantId);
    const recommendations = pricingOperationsService.generatePricingRecommendations(tenantId);

    return apiSuccess({
      pricing_rules_count: rules.length,
      pricing_rules: rules,
      executions_count: executions.length,
      executions: executions.slice(0, 20),
      recommendations,
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.PRICING_MANAGE);
    const tenantId = context.tenant.id;
    const body = await request.json();

    const created = db.createPricingRule({
      id: `pr_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      name: body.name,
      min_margin_percent: body.min_margin_percent,
      max_price_change_percent: body.max_price_change_percent || 20,
      max_daily_changes: body.max_daily_changes || 10,
      is_active: body.is_active !== undefined ? body.is_active : true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    return apiSuccess(created);
  } catch (err) {
    return apiError(err);
  }
}
