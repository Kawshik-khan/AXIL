import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ChannelService } from "@/domains/social/channels/channel.service";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const channel = await ChannelService.getChannelById(context, params.id);
    return apiSuccess({ channel });
  } catch (err) {
    return apiError(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();
    const updated = await ChannelService.updateChannel(context, params.id, body);
    return apiSuccess({ channel: updated });
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
    const result = await ChannelService.deleteChannel(context, params.id);
    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}
