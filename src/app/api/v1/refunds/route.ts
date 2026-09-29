import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ReturnService } from "@/domains/returns/return.service";
import { db } from "@/infrastructure/db";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.FINANCE_READ);

    const refunds = db.getRefunds(context.tenant.id);
    return apiSuccess({ refunds });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const refund = await ReturnService.processRefund(context, body);
    return apiSuccess({ refund }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
