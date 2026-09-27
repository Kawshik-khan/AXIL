import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { SocialOrderService } from "@/domains/social/commerce-integration/social-order.service";

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const order = await SocialOrderService.createOrderFromConversation(context, body);
    return apiSuccess({ order }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
