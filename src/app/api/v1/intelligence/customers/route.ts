import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { customerIntelligenceService } from "@/domains/intelligence/services/customer-intelligence.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_READ);
    let records = db.getCustomerIntelligence(context.tenant.id);
    if (records.length === 0) {
      records = customerIntelligenceService.analyzeCustomers(context.tenant.id);
    }

    return apiSuccess({ customers: records, total: records.length });
  } catch (err) {
    return apiError(err);
  }
}
