import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { db } from "@/infrastructure/db";
import { IdentityResolutionService } from "@/domains/social/identity/identity-resolution.service";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { withStore } from "@/lib/store-unit";

async function handleGET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.CUSTOMERS_READ);
    const identities = db.getCustomerIdentities(context.tenant.id, params.id);
    return apiSuccess({ identities });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.CUSTOMERS_UPDATE);
    const body = await request.json();

    const identity = await IdentityResolutionService.linkIdentity(
      context,
      params.id,
      body.identity_id
    );

    return apiSuccess({ identity });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
