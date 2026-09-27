import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ConversationService } from "@/domains/social/conversations/conversation.service";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const conversation = await ConversationService.addTag(context, params.id, body.tag);
    return apiSuccess({ conversation });
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);
    const tag = searchParams.get("tag") || "";

    const conversation = await ConversationService.removeTag(context, params.id, tag);
    return apiSuccess({ conversation });
  } catch (err) {
    return apiError(err);
  }
}
