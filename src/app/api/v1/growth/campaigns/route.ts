import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { campaignService } from "@/domains/growth/services/campaign.service";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_READ);
    const campaigns = db.getCampaigns(context.tenant.id);
    return apiSuccess({ campaigns, total: campaigns.length });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_WRITE);
    const body = await request.json();

    const campaign = campaignService.createCampaign({
      tenantId: context.tenant.id,
      name: body.name,
      objective: body.objective || "ENGAGEMENT",
      audienceId: body.audience_id,
      channel: body.channel || "WHATSAPP",
      variants: body.variants || [],
      offerId: body.offer_id,
      targetProducts: body.target_products,
      budgetBdt: body.budget_bdt,
      scheduledStartAt: body.scheduled_start_at,
      createdBy: context.user?.id || "USER",
    });

    return apiSuccess({ campaign }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
