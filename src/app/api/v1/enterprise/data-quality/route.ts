import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { dataQualityService } from "@/domains/enterprise/services/data-quality.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("organization_id") || "org_default";

    const issues = dataQualityService.runQualityAudit(orgId, context.tenant.id);
    const rules = db.getDataQualityRules(orgId);

    return apiSuccess({
      health_score_pct: issues.length === 0 ? 100 : Math.max(65, 100 - issues.length * 5),
      open_defects_count: issues.length,
      rules_count: rules.length,
      rules,
      issues,
    });
  } catch (err) {
    return apiError(err);
  }
}
