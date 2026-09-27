import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { campaignService } from "@/domains/growth/services/campaign.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const campaigns = db.getCampaigns(context.tenant.id);
    return apiSuccess({ campaigns, total: campaigns.length });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
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
