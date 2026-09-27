import { ChannelType, MessageType } from "@/types/social";
import { BadRequestError } from "@/lib/errors";

export interface PolicyCheckResult {
  allowed: boolean;
  requiresTemplate: boolean;
  reason?: string;
}

export class ChannelPolicyService {
  // Meta platforms enforce strict 24-hour customer care window for arbitrary messaging
  private static readonly META_WINDOW_HOURS = 24;
  private static readonly MAX_MEDIA_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

  public static validateOutbound(
    channelType: ChannelType,
    lastCustomerInboundAt?: string,
    messageType: MessageType = "TEXT",
    text?: string,
    attachmentSize?: number
  ): PolicyCheckResult {
    // 1. Text character limits
    if (text) {
      const maxLen = channelType === "WHATSAPP" ? 4096 : 2000;
      if (text.length > maxLen) {
        return {
          allowed: false,
          requiresTemplate: false,
          reason: `Message exceeds maximum allowed length of ${maxLen} characters for ${channelType}.`,
        };
      }
    }

    // 2. Attachment size limit
    if (attachmentSize && attachmentSize > this.MAX_MEDIA_SIZE_BYTES) {
      return {
        allowed: false,
        requiresTemplate: false,
        reason: `Attachment size exceeds platform limit of 25 MB.`,
      };
    }

    // 3. 24-hour window policy for Meta (Facebook & Instagram & WhatsApp)
    if (channelType === "FACEBOOK_MESSENGER" || channelType === "INSTAGRAM" || channelType === "WHATSAPP") {
      if (!lastCustomerInboundAt) {
        return {
          allowed: false,
          requiresTemplate: true,
          reason: `No inbound message recorded from customer. Outbound messaging requires an approved pre-registered template outside the 24-hour window.`,
        };
      }

      const elapsedMs = Date.now() - new Date(lastCustomerInboundAt).getTime();
      const elapsedHours = elapsedMs / (1000 * 60 * 60);

      if (elapsedHours > this.META_WINDOW_HOURS) {
        return {
          allowed: false,
          requiresTemplate: true,
          reason: `24-hour messaging window has expired (${Math.round(elapsedHours)} hours elapsed). Only approved templates or message tags may be sent.`,
        };
      }
    }

    return {
      allowed: true,
      requiresTemplate: false,
    };
  }

  public static assertCanSend(
    channelType: ChannelType,
    lastCustomerInboundAt?: string,
    messageType: MessageType = "TEXT",
    text?: string
  ): void {
    const result = this.validateOutbound(channelType, lastCustomerInboundAt, messageType, text);
    if (!result.allowed) {
      throw new BadRequestError(result.reason || "Outbound message rejected by channel policy.");
    }
  }
}
