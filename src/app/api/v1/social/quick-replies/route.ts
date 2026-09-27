import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { QuickReplyService } from "@/domains/social/templates/quick-reply.service";
import { QuickReplyCategory } from "@/types/social";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);
    const category = (searchParams.get("category") as QuickReplyCategory) || undefined;

    const quickReplies = await QuickReplyService.listQuickReplies(context, category);
    return apiSuccess({ quickReplies });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const quickReply = await QuickReplyService.createQuickReply(context, body);
    return apiSuccess({ quickReply }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id") || "";

    const result = await QuickReplyService.deleteQuickReply(context, id);
    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}
