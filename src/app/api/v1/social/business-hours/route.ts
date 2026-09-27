import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { QuickReplyService } from "@/domains/social/templates/quick-reply.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const businessHours = await QuickReplyService.getBusinessHours(context);
    return apiSuccess({ businessHours });
  } catch (err) {
    return apiError(err);
  }
}

export async function PUT(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const updated = await QuickReplyService.updateBusinessHours(context, body);
    return apiSuccess({ businessHours: updated });
  } catch (err) {
    return apiError(err);
  }
}
