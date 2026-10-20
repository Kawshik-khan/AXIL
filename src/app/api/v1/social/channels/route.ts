import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { parseOrThrow, readJson } from "@/lib/validation";
import { db } from "@/infrastructure/db";
import { ChannelService } from "@/domains/social/channels/channel.service";
import { verifyMetaAccountOwnership } from "@/domains/social/meta/meta-login.service";
import { withStore } from "@/lib/store-unit";
import { BadRequestError } from "@/lib/errors";

const ConnectBody = z
  .object({
    type: z.enum(["FACEBOOK_MESSENGER", "INSTAGRAM", "WHATSAPP", "WEBSITE_CHAT", "TIKTOK", "TELEGRAM", "EMAIL", "SMS", "MARKETPLACE"]),
    name: z.string().trim().min(1).max(120),
    provider_account_id: z.string().trim().min(1).max(128),
    external_page_id: z.string().max(128).optional(),
    external_business_id: z.string().max(128).optional(),
    external_phone_number_id: z.string().max(128).optional(),
    credentials: z.record(z.string(), z.unknown()),
    configuration: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const channels = await ChannelService.listChannels(context);
    return apiSuccess({ channels });
  } catch (err) {
    return apiError(err);
  }
}

/**
 * Runs outside the store lock (`unit: false`): a pasted Facebook / Instagram token is first checked with Meta to belong
 * to the account it claims, then the channel is saved in one short unit of work.
 */
async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = parseOrThrow(ConnectBody, await readJson(request));
    // A pasted token can't prove which WhatsApp number it owns, and webhooks for numbers subscribed to the platform app
    // are signed with the platform secret: WhatsApp is connected only through "Connect WhatsApp" (ADR-119 P5)
    if (body.type === "WHATSAPP") {
      throw new BadRequestError("Connect WhatsApp from Connectors (Connect WhatsApp); a pasted token can't be used (USE_SIGN_IN).");
    }
    if (body.type === "FACEBOOK_MESSENGER" || body.type === "INSTAGRAM") {
      const token = typeof body.credentials.accessToken === "string" ? body.credentials.accessToken : "";
      await verifyMetaAccountOwnership(body.type, body.provider_account_id, token);
    }
    const channel = await db.unit(() => ChannelService.connectChannel(context, body), () => true);
    return apiSuccess({ channel }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST, { unit: false });
