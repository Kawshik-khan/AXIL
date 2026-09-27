import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ChannelService } from "@/domains/social/channels/channel.service";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const result = await ChannelService.testChannelHealth(context, params.id);
    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}
