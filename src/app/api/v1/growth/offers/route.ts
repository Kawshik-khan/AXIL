import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { offerService } from "@/domains/growth/services/offer.service";
import { GrowthOffer } from "@/types/growth";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_READ);
    const offers = db.getOffers(context.tenant.id);
    return apiSuccess({ offers, total: offers.length });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_WRITE);
    const body = await request.json();

    const now = new Date().toISOString();
    const offerInput: GrowthOffer = {
      id: `off_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      tenant_id: context.tenant.id,
      code: body.code,
      title: body.title || body.name || "Special Offer",
      description: body.description || "",
      type: body.type || "PERCENTAGE",
      value: body.value || 10,
      rules: body.rules || {},
      starts_at: body.starts_at || now,
      expires_at: body.expires_at || new Date(Date.now() + 30 * 86400000).toISOString(),
      is_active: true,
      current_usage_count: 0,
      created_at: now,
    };

    const offer = offerService.createOffer(offerInput);
    return apiSuccess({ offer }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
