/**
 * CommerceOS Phase 7: Marketing Channel Abstraction & Orchestration Service
 * Integrates WhatsApp, Messenger, Instagram, Web Chat, Email, and Telegram for governed campaign delivery.
 */

import { ChannelService } from "@/domains/social/channels/channel.service";
import {
  MarketingChannelType,
  ChannelDeliveryResult,
} from "@/types/growth";

/**
 * No marketing channel is integrated yet, so nothing is sent: report NOT_SENT, never a made-up message id and
 * delivery time (FX-31, non-negotiable 7). Campaign results then show these as failed, not delivered.
 */
function notSent(channel: MarketingChannelType, recipientId: string): ChannelDeliveryResult {
  return {
    success: false,
    channel,
    recipient_id: recipientId,
    error_message: `CHANNEL_NOT_CONNECTED: ${channel} sending isn't implemented yet. Nothing was sent.`,
  };
}

export interface IMarketingChannelAdapter {
  readonly channelType: MarketingChannelType;
  validateRecipient(recipientId: string): boolean;
  sendMessage(params: {
    tenantId: string;
    recipientId: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<ChannelDeliveryResult>;
  sendTemplate(params: {
    tenantId: string;
    recipientId: string;
    templateId: string;
    parameters: Record<string, string>;
  }): Promise<ChannelDeliveryResult>;
}

export class WhatsAppMarketingAdapter implements IMarketingChannelAdapter {
  public readonly channelType: MarketingChannelType = "WHATSAPP";

  public validateRecipient(recipientId: string): boolean {
    // Valid Bangladeshi phone number format
    return /^(\+?8801|01)[3-9]\d{8}$/.test(recipientId.replace(/[\s-]/g, ""));
  }

  public async sendMessage(params: {
    tenantId: string;
    recipientId: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<ChannelDeliveryResult> {
    const isValid = this.validateRecipient(params.recipientId);
    if (!isValid) {
      return {
        success: false,
        channel: "WHATSAPP",
        recipient_id: params.recipientId,
        error_message: `Invalid Bangladeshi mobile phone format: ${params.recipientId}`,
      };
    }

    return notSent("WHATSAPP", params.recipientId);
  }

  public async sendTemplate(params: {
    tenantId: string;
    recipientId: string;
    templateId: string;
    parameters: Record<string, string>;
  }): Promise<ChannelDeliveryResult> {
    return this.sendMessage({
      tenantId: params.tenantId,
      recipientId: params.recipientId,
      content: `Template ${params.templateId} sent with parameters`,
    });
  }
}

export class FacebookMarketingAdapter implements IMarketingChannelAdapter {
  public readonly channelType: MarketingChannelType = "FACEBOOK_MESSENGER";

  public validateRecipient(recipientId: string): boolean {
    return recipientId.length > 5;
  }

  public async sendMessage(params: {
    tenantId: string;
    recipientId: string;
    content: string;
  }): Promise<ChannelDeliveryResult> {
    return notSent("FACEBOOK_MESSENGER", params.recipientId);
  }

  public async sendTemplate(params: any): Promise<ChannelDeliveryResult> {
    return this.sendMessage(params);
  }
}

export class InstagramMarketingAdapter implements IMarketingChannelAdapter {
  public readonly channelType: MarketingChannelType = "INSTAGRAM";

  public validateRecipient(recipientId: string): boolean {
    return recipientId.length > 3;
  }

  public async sendMessage(params: {
    tenantId: string;
    recipientId: string;
    content: string;
  }): Promise<ChannelDeliveryResult> {
    return notSent("INSTAGRAM", params.recipientId);
  }

  public async sendTemplate(params: any): Promise<ChannelDeliveryResult> {
    return this.sendMessage(params);
  }
}

export class WebsiteMarketingAdapter implements IMarketingChannelAdapter {
  public readonly channelType: MarketingChannelType = "WEBSITE_CHAT";

  public validateRecipient(recipientId: string): boolean {
    return Boolean(recipientId);
  }

  public async sendMessage(params: {
    tenantId: string;
    recipientId: string;
    content: string;
  }): Promise<ChannelDeliveryResult> {
    return notSent("WEBSITE_CHAT", params.recipientId);
  }

  public async sendTemplate(params: any): Promise<ChannelDeliveryResult> {
    return this.sendMessage(params);
  }
}

export class EmailMarketingAdapter implements IMarketingChannelAdapter {
  public readonly channelType: MarketingChannelType = "EMAIL";

  public validateRecipient(recipientId: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientId);
  }

  public async sendMessage(params: {
    tenantId: string;
    recipientId: string;
    content: string;
  }): Promise<ChannelDeliveryResult> {
    if (!this.validateRecipient(params.recipientId)) {
      return {
        success: false,
        channel: "EMAIL",
        recipient_id: params.recipientId,
        error_message: `Invalid email address format: ${params.recipientId}`,
      };
    }

    return notSent("EMAIL", params.recipientId);
  }

  public async sendTemplate(params: any): Promise<ChannelDeliveryResult> {
    return this.sendMessage(params);
  }
}

export class TelegramMarketingAdapter implements IMarketingChannelAdapter {
  public readonly channelType: MarketingChannelType = "TELEGRAM";

  public validateRecipient(recipientId: string): boolean {
    return recipientId.length > 4;
  }

  public async sendMessage(params: {
    tenantId: string;
    recipientId: string;
    content: string;
  }): Promise<ChannelDeliveryResult> {
    return notSent("TELEGRAM", params.recipientId);
  }

  public async sendTemplate(params: any): Promise<ChannelDeliveryResult> {
    return this.sendMessage(params);
  }
}

export class MarketingChannelService {
  private adapters: Record<MarketingChannelType, IMarketingChannelAdapter> = {
    WHATSAPP: new WhatsAppMarketingAdapter(),
    FACEBOOK_MESSENGER: new FacebookMarketingAdapter(),
    INSTAGRAM: new InstagramMarketingAdapter(),
    WEBSITE_CHAT: new WebsiteMarketingAdapter(),
    EMAIL: new EmailMarketingAdapter(),
    TELEGRAM: new TelegramMarketingAdapter(),
  };

  public getAdapter(channel: MarketingChannelType): IMarketingChannelAdapter {
    const adapter = this.adapters[channel];
    if (!adapter) {
      throw new Error(`Unsupported marketing channel: ${channel}`);
    }
    return adapter;
  }

  /**
   * Dispatches a message through the appropriate channel adapter
   */
  public async dispatchMessage(params: {
    tenantId: string;
    channel: MarketingChannelType;
    recipientId: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<ChannelDeliveryResult> {
    const adapter = this.getAdapter(params.channel);
    return adapter.sendMessage(params);
  }
}

export const marketingChannelService = new MarketingChannelService();
