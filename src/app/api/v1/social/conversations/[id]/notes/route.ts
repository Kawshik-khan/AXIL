import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { MessageService } from "@/domains/social/messages/message.service";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const note = await MessageService.createInternalNote(context, params.id, body.text);
    return apiSuccess({ message: note }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
