import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { financeOperationsService } from "@/domains/operations/services/finance-operations.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.FINANCE_READ);
    const tenantId = context.tenant.id;

    const runs = db.getReconciliationRuns(tenantId);
    const exceptions = db.getFinancialExceptions(tenantId);

    return apiSuccess({
      runs_count: runs.length,
      runs,
      unresolved_exceptions_count: exceptions.filter((e) => e.status !== "RESOLVED").length,
      exceptions,
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.OPERATIONS_EXECUTE);
    const tenantId = context.tenant.id;

    const run = financeOperationsService.executeReconciliationRun(tenantId);
    return apiSuccess(run);
  } catch (err) {
    return apiError(err);
  }
}
