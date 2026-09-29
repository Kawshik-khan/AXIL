import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { operationalSLAService } from "@/domains/operations/services/operational-sla.service";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.OPERATIONS_READ);
    const tenantId = context.tenant.id;

    const policies = db.getSLAPolicies(tenantId);
    const breaches = db.getSLABreaches(tenantId);
    const evaluated = operationalSLAService.auditSLAs(tenantId);

    return apiSuccess({
      policies_count: policies.length,
      policies,
      breaches_count: breaches.length,
      breaches: breaches.slice(0, 20),
      evaluated_active_breaches: evaluated.active_breaches,
      risks_at_warning: evaluated.risks_at_warning,
    });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
