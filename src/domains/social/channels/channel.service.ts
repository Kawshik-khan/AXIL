import { randomSuffix } from "@/lib/ids";
import { db } from "@/infrastructure/db";
import { ConnectedChannel, ChannelType, ChannelStatus } from "@/types/social";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { encryptCredential, decryptCredential, maskSecret } from "@/lib/security";
import { AppError, BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { IChannelProvider, ChannelCredentials } from "./channel-provider.interface";
import { FacebookAdapter } from "./adapters/facebook.adapter";
import { InstagramAdapter } from "./adapters/instagram.adapter";
import { WhatsAppAdapter } from "./adapters/whatsapp.adapter";
import { WebsiteChatAdapter } from "./adapters/website-chat.adapter";
import { TelegramAdapter } from "./adapters/telegram.adapter";
import { assertWithinLimit } from "@/lib/safety-gate";

/** Channel types whose inbound webhooks are routed by `provider_account_id` (Page id / WhatsApp phone number id). */
export const PROVIDER_ROUTED_TYPES: ReadonlySet<ChannelType> = new Set<ChannelType>(["FACEBOOK_MESSENGER", "INSTAGRAM", "WHATSAPP"]);

export class ChannelService {
  private static adapters: Record<ChannelType, IChannelProvider> = {
    FACEBOOK_MESSENGER: new FacebookAdapter(),
    INSTAGRAM: new InstagramAdapter(),
    WHATSAPP: new WhatsAppAdapter(),
    WEBSITE_CHAT: new WebsiteChatAdapter(),
    TIKTOK: new FacebookAdapter() as any, // Extensible fallback
    TELEGRAM: new TelegramAdapter(),
    EMAIL: new FacebookAdapter() as any,
    SMS: new FacebookAdapter() as any,
    MARKETPLACE: new FacebookAdapter() as any,
  };

  public static getAdapter(type: ChannelType): IChannelProvider {
    const adapter = this.adapters[type];
    if (!adapter) {
      throw new BadRequestError(`Channel provider '${type}' is not supported.`);
    }
    return adapter;
  }

  public static async listChannels(
    context: RequestContext
  ): Promise<Array<Omit<ConnectedChannel, "credentials_encrypted"> & { credentials_masked: Record<string, string> }>> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CHANNEL_READ);
    const channels = db.getConnectedChannels(context.tenant.id);

    return channels.map((ch) => {
      let masked: Record<string, string> = {};
      try {
        const decrypted = decryptCredential<Record<string, string>>(ch.credentials_encrypted);
        for (const [key, val] of Object.entries(decrypted)) {
          masked[key] = maskSecret(val);
        }
      } catch {
        masked = { token: "••••••••" };
      }

      const { credentials_encrypted: _, ...safeChannel } = ch;
      return {
        ...safeChannel,
        credentials_masked: masked,
      };
    });
  }

  public static async getChannelById(
    context: RequestContext,
    channelId: string
  ): Promise<ConnectedChannel> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CHANNEL_READ);
    const channel = db.findConnectedChannelById(context.tenant.id, channelId);
    if (!channel) {
      throw new NotFoundError(`Channel '${channelId}' not found.`);
    }
    return channel;
  }

  public static async connectChannel(
    context: RequestContext,
    payload: {
      type: ChannelType;
      name: string;
      provider_account_id: string;
      external_page_id?: string;
      external_business_id?: string;
      external_phone_number_id?: string;
      credentials: Record<string, unknown>;
      configuration?: Record<string, unknown>;
    }
  ): Promise<ConnectedChannel> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CHANNEL_MANAGE);
    assertWithinLimit(context.tenant.id, "max_channels"); // plan limit (FX-34)

    if (!payload.type || !payload.provider_account_id || !payload.name) {
      throw new BadRequestError("Channel type, name, and provider account ID are required.");
    }

    // Meta webhooks are routed by provider account id, so one account can belong to only one channel; otherwise a
    // workspace could claim another's Page / phone number and receive its customers' messages (audit H5).
    if (PROVIDER_ROUTED_TYPES.has(payload.type) && db.findConnectedChannelsByProviderId(payload.type, payload.provider_account_id).length > 0) {
      throw new ConflictError("This account is already connected to a CommerceOS workspace.");
    }

    const adapter = this.getAdapter(payload.type);
    const validation = await adapter.validateCredentials(payload.credentials);
    if (!validation.valid) {
      throw new BadRequestError(`Channel credentials invalid: ${validation.error}`);
    }

    const encrypted = encryptCredential(payload.credentials);

    const newChannel: ConnectedChannel = {
      id: `chn_${payload.type.toLowerCase().slice(0, 3)}_${Date.now()}_${randomSuffix()}`,
      tenant_id: context.tenant.id,
      type: payload.type,
      name: payload.name,
      status: "ACTIVE",
      provider_account_id: payload.provider_account_id,
      external_page_id: payload.external_page_id,
      external_business_id: payload.external_business_id,
      external_phone_number_id: payload.external_phone_number_id,
      credentials_encrypted: encrypted,
      configuration: {
        welcome_message: "স্বাগতম! আমাদের সাথে যোগাযোগ করার জন্য ধন্যবাদ। আমরা কীভাবে আপনাকে সাহায্য করতে পারি?",
        auto_reply_enabled: true,
        ...payload.configuration,
      },
      last_sync_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return db.createConnectedChannel(newChannel);
  }

  /**
   * The channel a Telegram connector feeds: created when the connector is saved, reused afterwards. Telegram has one
   * webhook per bot, so the channel is routed by the connector id (/api/v1/connectors/<id>/webhook), not by an account id.
   */
  public static assertTelegramBotAvailable(tenantId: string, connectorId: string | undefined, rawToken: string): string {
    const botId = rawToken.trim().split(":")[0].trim();
    if (!/^\d{3,20}$/.test(botId)) throw new BadRequestError("The Telegram bot token is malformed.");
    const currentChannel = connectorId
      ? db.getConnectedChannels(tenantId).find((c) => c.connector_id === connectorId)
      : undefined;
    const duplicate = db.findConnectedChannelsByProviderId("TELEGRAM", botId).find((c) => c.id !== currentChannel?.id);
    if (duplicate) throw new ConflictError("This Telegram bot is already connected to a CommerceOS workspace.");
    return botId;
  }

  public static ensureChannelForTelegramConnector(tenantId: string, connector: { id: string; name: string; credentials_encrypted: string }): ConnectedChannel {
    const existing = db.getConnectedChannels(tenantId).find((c) => c.connector_id === connector.id);
    const creds = decryptCredential<Record<string, unknown>>(connector.credentials_encrypted);
    const rawToken = typeof creds.bot_token === "string" ? creds.bot_token.trim() : String(creds.bot_token ?? "").trim();
    const botId = this.assertTelegramBotAvailable(tenantId, connector.id, rawToken);
    if (existing) {
      if (existing.provider_account_id === botId && existing.name === connector.name) return existing;
      return db.updateConnectedChannel(tenantId, existing.id, {
        provider_account_id: botId,
        name: connector.name,
        updated_at: new Date().toISOString(),
      });
    }
    assertWithinLimit(tenantId, "max_channels");
    const now = new Date().toISOString();
    return db.createConnectedChannel({
      id: `chn_tel_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      type: "TELEGRAM",
      name: connector.name,
      status: "ACTIVE",
      provider_account_id: botId,
      credentials_encrypted: "",
      connector_id: connector.id,
      // Customer-initiated conversations are visible in the inbox; automated replies require an explicit later opt-in.
      configuration: { auto_reply_enabled: false },
      last_sync_at: now,
      created_at: now,
      updated_at: now,
    });
  }

  public static async updateChannel(
    context: RequestContext,
    channelId: string,
    patch: {
      name?: string;
      status?: ChannelStatus;
      configuration?: Record<string, unknown>;
      credentials?: Record<string, unknown>;
    }
  ): Promise<ConnectedChannel> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CHANNEL_MANAGE);
    const existing = await this.getChannelById(context, channelId);

    const updateData: Partial<ConnectedChannel> = {};
    if (patch.name) updateData.name = patch.name;
    if (patch.status) updateData.status = patch.status;
    if (patch.configuration) {
      updateData.configuration = {
        ...existing.configuration,
        ...patch.configuration,
      };
    }
    if (patch.credentials) {
      updateData.credentials_encrypted = encryptCredential(patch.credentials);
    }

    return db.updateConnectedChannel(context.tenant.id, channelId, updateData);
  }

  public static async deleteChannel(
    context: RequestContext,
    channelId: string
  ): Promise<{ success: boolean }> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CHANNEL_MANAGE);
    await this.getChannelById(context, channelId);
    const deleted = db.deleteConnectedChannel(context.tenant.id, channelId);
    return { success: deleted };
  }

  /**
   * Decrypts a channel's stored credentials. Fails loudly (FX-03, audit H5-b): returning {} used to make
   * webhook verification fall back to built-in default secrets. Callers decide how to degrade.
   */
  public static getDecryptedCredentials(channel: ConnectedChannel): ChannelCredentials {
    try {
      if (channel.connector_id) {
        // The credentials live in the connector, so there is one copy to rotate and revoke (connector plan D3)
        const connector = db.findConnectorById(channel.tenant_id, channel.connector_id);
        if (!connector || connector.enabled === false) throw new Error("connector missing or disabled");
        return decryptCredential<ChannelCredentials>(connector.credentials_encrypted);
      }
      return decryptCredential<ChannelCredentials>(channel.credentials_encrypted);
    } catch {
      throw new AppError(
        "CHANNEL_CREDENTIALS_INVALID",
        "This channel's stored credentials could not be read. Reconnect the channel to update them.",
        424
      );
    }
  }

  public static async testChannelHealth(
    context: RequestContext,
    channelId: string
  ): Promise<{ healthy: boolean; status: ChannelStatus; verified?: boolean; error?: string }> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CHANNEL_READ);
    const channel = await this.getChannelById(context, channelId);
    const adapter = this.getAdapter(channel.type);
    let creds: ChannelCredentials;
    try {
      creds = this.getDecryptedCredentials(channel);
    } catch (err) {
      const error = err instanceof Error ? err.message : "Channel credentials could not be read.";
      db.updateConnectedChannel(context.tenant.id, channelId, { status: "ERROR", error_message: error });
      return { healthy: false, status: "ERROR", error };
    }

    const result = await adapter.validateCredentials(creds);
    if (result.valid && result.verified === false) {
      // Credentials have the right shape but weren't checked with the provider (FX-31). Inbound webhooks still work,
      // so the channel keeps its status; the check just doesn't claim a live connection.
      return { healthy: false, status: channel.status, verified: false, error: result.error };
    }
    if (!result.valid) {
      db.updateConnectedChannel(context.tenant.id, channelId, {
        status: "ERROR",
        error_message: result.error,
      });
      return { healthy: false, status: "ERROR", error: result.error };
    }

    db.updateConnectedChannel(context.tenant.id, channelId, {
      status: "ACTIVE",
      error_message: undefined,
      last_sync_at: new Date().toISOString(),
    });
    return { healthy: true, status: "ACTIVE" };
  }
}
