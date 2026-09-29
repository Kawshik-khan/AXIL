import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ChannelService } from "@/domains/social/channels/channel.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const channels = await ChannelService.listChannels(context);
    return apiSuccess({ channels });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();
    const channel = await ChannelService.connectChannel(context, body);
    return apiSuccess({ channel }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
