import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { exceptionManagementService } from "@/domains/operations/services/exception-management.service";
import { withStore } from "@/lib/store-unit";

async function handlePOST(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.EXCEPTIONS_MANAGE);
    const tenantId = context.tenant.id;
    const exceptionId = params.id;
    const body = await request.json();

    const resolved = exceptionManagementService.resolveException(
      tenantId,
      exceptionId,
      body.resolution_notes || "Resolved by operator via control plane.",
      context.user.id
    );

    return apiSuccess(resolved);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
