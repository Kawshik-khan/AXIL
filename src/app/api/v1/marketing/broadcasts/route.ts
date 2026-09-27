import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { marketingService } from "@/domains/marketing/marketing.service";

const CreateBroadcastSchema = z.object({
  name: z.string().min(1, "Campaign name is required"),
  objective: z.enum([
    "AWARENESS",
    "ENGAGEMENT",
    "CONVERSION",
    "RETENTION",
    "REACTIVATION",
    "UPSELL",
    "CROSS_SELL",
    "CUSTOMER_SERVICE",
  ]).default("CONVERSION"),
  audience_id: z.string().min(1, "Target audience ID is required"),
  channel: z.enum([
    "WHATSAPP",
    "FACEBOOK_MESSENGER",
    "INSTAGRAM",
    "WEBSITE_CHAT",
    "EMAIL",
    "TELEGRAM",
  ]).default("WHATSAPP"),
  content_body: z.string().min(1, "Content body is required"),
  call_to_action: z.string().default("Shop Now"),
  budget_bdt: z.number().nonnegative().optional(),
  offer_id: z.string().optional(),
  target_products: z.array(z.string()).optional(),
  scheduled_start_at: z.string().optional(),
});

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const campaigns = marketingService.getBroadcastCampaigns(context.tenant.id);
    return apiSuccess({ campaigns, total: campaigns.length });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();
    const validated = CreateBroadcastSchema.parse(body);

    const campaign = marketingService.createBroadcastCampaign({
      tenantId: context.tenant.id,
      name: validated.name,
      objective: validated.objective,
      audienceId: validated.audience_id,
      channel: validated.channel,
      contentBody: validated.content_body,
      callToAction: validated.call_to_action,
      budgetBdt: validated.budget_bdt,
      offerId: validated.offer_id,
      targetProducts: validated.target_products,
      scheduledStartAt: validated.scheduled_start_at,
      userId: context.user?.id,
    });

    return apiSuccess({ campaign }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
