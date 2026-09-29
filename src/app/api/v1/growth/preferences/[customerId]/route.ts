import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { consentService } from "@/domains/growth/services/consent.service";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";

async function handleGET(
  request: Request,
  { params }: { params: Promise<{ customerId: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_READ);
    const { customerId } = await params;
    const preferences = db.getCommunicationPreferences(context.tenant.id, customerId);
    return apiSuccess({ preferences });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ customerId: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_WRITE);
    const { customerId } = await params;
    const body = await request.json();

    const preference = consentService.setPreference({
      tenantId: context.tenant.id,
      customerId,
      channel: body.channel || "WHATSAPP",
      purpose: body.purpose || "MARKETING",
      status: body.status || "OPTED_IN",
      consentSource: body.opt_in_source || "WEB_PREFERENCE_CENTER",
    });

    return apiSuccess({ preference });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
