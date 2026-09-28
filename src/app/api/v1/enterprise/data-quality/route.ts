import { resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { dataQualityService } from "@/domains/enterprise/services/data-quality.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.DATA_QUALITY_READ);
    const { searchParams } = new URL(request.url);
    const orgId = resolveOrganizationId(context, searchParams.get("organization_id"));

    const issues = dataQualityService.previewQualityAudit(orgId, context.tenant.id); // read-only (FX-21)
    const rules = db.getDataQualityRules(orgId);

    return apiSuccess({
      health_score_pct: null, // no defined score; was 100 - 5 per issue, floored at 65 (FX-30)
      open_defects_count: issues.length,
      rules_count: rules.length,
      rules,
      issues,
    });
  } catch (err) {
    return apiError(err);
  }
}
