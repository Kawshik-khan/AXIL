import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ReturnService } from "@/domains/returns/return.service";
import { db } from "@/infrastructure/db";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.FINANCE_READ);

    const refunds = db.getRefunds(context.tenant.id);
    return apiSuccess({ refunds });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const refund = await ReturnService.processRefund(context, body);
    return apiSuccess({ refund }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
