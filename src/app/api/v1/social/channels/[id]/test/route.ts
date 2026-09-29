import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ChannelService } from "@/domains/social/channels/channel.service";
import { withStore } from "@/lib/store-unit";

async function handlePOST(
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

export const POST = withStore("POST", handlePOST);
