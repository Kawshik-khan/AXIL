import { randomSuffix } from "@/lib/ids";
import crypto from "crypto";
import { db } from "@/infrastructure/db";
import { CommerceEvent } from "@/types/commerce";
import { OutboundWebhookDelivery } from "@/types/social";

export interface SocialEventEnvelope {
  tenantId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  actor: { type: "USER" | "SYSTEM" | "CUSTOMER" | "BOT"; id: string };
  payload: Record<string, unknown>;
  correlationId?: string;
  causationId?: string;
}

export class SocialEventService {
  /**
   * Authoritatively record and publish a social commerce event into the outbox
   */
  public static emit(envelope: SocialEventEnvelope): CommerceEvent {
    const eventId = `evt_soc_${Date.now()}_${randomSuffix()}`;
    const event: CommerceEvent = {
      id: eventId,
      type: envelope.eventType,
      version: "1.0",
      tenant_id: envelope.tenantId,
      aggregate_type: envelope.aggregateType,
      aggregate_id: envelope.aggregateId,
      actor_id: envelope.actor.id,
      correlation_id: envelope.correlationId || `corr_${Date.now()}_${randomSuffix()}`,
      timestamp: new Date().toISOString(),
      payload: envelope.payload,
    };

    // 1. Atomic DB outbox record
    db.recordEvent(event);

    // 2. Dispatch to registered Webhook Subscriptions (n8n / external automations)
    this.dispatchToWebhooks(event).catch(() => {
      // Background fanout error handling
    });

    return event;
  }

  /**
   * Fan-out event to matching tenant webhook subscriptions (n8n integration)
   */
  private static async dispatchToWebhooks(event: CommerceEvent): Promise<void> {
    const subs = db.getWebhooks(event.tenant_id);
    const matching = subs.filter(
      (s) => s.status === "ACTIVE" && (s.events.includes("*") || s.events.includes(event.type))
    );

    const payloadJson = JSON.stringify(event);

    for (const sub of matching) {
      const signature = this.generateHmacSignature(payloadJson, sub.secret);
      const deliveryId = `del_${Date.now()}_${randomSuffix()}`;

      const delivery: OutboundWebhookDelivery = {
        id: deliveryId,
        tenant_id: event.tenant_id,
        subscription_id: sub.id,
        event_id: event.id,
        event_type: event.type,
        target_url: sub.url,
        status: "SUCCESS", // Default simulated delivery in sandbox
        attempt_count: 1,
        response_code: 200,
        created_at: new Date().toISOString(),
        delivered_at: new Date().toISOString(),
      };

      db.recordOutboundDelivery(delivery);
    }
  }

  public static generateHmacSignature(payload: string, secret: string): string {
    return crypto.createHmac("sha256", secret).update(payload).digest("hex");
  }

  public static verifyHmacSignature(payload: string, secret: string, signature: string): boolean {
    const expected = this.generateHmacSignature(payload, secret);
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }
}
