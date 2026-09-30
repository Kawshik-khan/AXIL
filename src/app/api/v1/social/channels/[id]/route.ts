import { z } from "zod";
import { parseOrThrow, readJson } from "@/lib/validation";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ChannelService } from "@/domains/social/channels/channel.service";
import { withStore } from "@/lib/store-unit";

// FX-12: channel fields an operator may change; tenant, type and provider account id are fixed.
const ChannelPatch = z
  .object({
    name: z.string().trim().min(1).max(100),
    status: z.enum(["ACTIVE", "INACTIVE", "DISCONNECTED"]),
    configuration: z
      .object({
        welcome_message: z.string().max(1000),
        auto_reply_enabled: z.boolean(),
        widget_color: z.string().max(32),
        widget_position: z.enum(["bottom-right", "bottom-left"]),
        allowed_domains: z.array(z.string().trim().min(1).max(253)).max(50),
      })
      .partial()
      .strict(),
    credentials: z.record(z.string().max(4096)),
  })
  .partial()
  .strict();

async function handleGET(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const channel = await ChannelService.getChannelById(context, params.id);
    return apiSuccess({ channel });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePATCH(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const body = parseOrThrow(ChannelPatch, await readJson(request));
    const updated = await ChannelService.updateChannel(context, params.id, body);
    return apiSuccess({ channel: updated });
  } catch (err) {
    return apiError(err);
  }
}

async function handleDELETE(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const result = await ChannelService.deleteChannel(context, params.id);
    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const PATCH = withStore("PATCH", handlePATCH);
export const DELETE = withStore("DELETE", handleDELETE);
