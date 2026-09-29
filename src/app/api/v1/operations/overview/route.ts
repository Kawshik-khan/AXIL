import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { operationalTwinService } from "@/domains/operations/services/operational-twin.service";
import { operationalBudgetService } from "@/domains/operations/services/operational-budget.service";
import { providerHealthService } from "@/domains/operations/services/provider-health.service";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.OPERATIONS_READ);
    const tenantId = context.tenant.id;

    const twin = operationalTwinService.getDigitalTwin(tenantId);
    const budget = operationalBudgetService.getBudget(tenantId);
    const providerHealth = providerHealthService.getProviderHealthMap(tenantId);
    const recentReceipts = db.getActionReceipts(tenantId).slice(0, 10);
    const openExceptions = db.getOperationalExceptions(tenantId).filter((e) => e.status !== "RESOLVED");

    return apiSuccess({
      twin,
      budget,
      providers: providerHealth,
      open_exceptions_count: openExceptions.length,
      recent_receipts_count: recentReceipts.length,
      recent_receipts: recentReceipts,
    });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
