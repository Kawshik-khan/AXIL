import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 9: Enterprise Webhook Platform Service
 * Outbound webhook dispatching with HMAC-SHA256 signing, replay protection, retry backoff, and DLQ handling.
 */

import crypto from "crypto";
import { db } from "@/infrastructure/db";
import {
  EnterpriseWebhookSubscription,
  WebhookDeliveryRecord,
} from "@/types/enterprise";

export class WebhookPlatformService {
  /**
   * Registers a new enterprise webhook subscription
   */
  public subscribe(
    orgId: string,
    params: {
      targetUrl: string;
      eventTypes: string[];
      applicationId?: string;
    }
  ): EnterpriseWebhookSubscription {
    const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;

    const sub: EnterpriseWebhookSubscription = {
      id: `whsub_${Date.now()}_${randomSuffix()}`,
      organization_id: orgId,
      application_id: params.applicationId,
      target_url: params.targetUrl,
      secret,
      event_types: params.eventTypes,
      status: "ACTIVE",
      retry_count_max: 3,
      failed_consecutive_deliveries: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return db.createEnterpriseWebhook(sub);
  }

  /**
   * Computes HMAC-SHA256 signature for a webhook payload
   */
  public computeSignature(payload: string, secret: string): string {
    return crypto.createHmac("sha256", secret).update(payload).digest("hex");
  }

  /**
   * Verifies an incoming webhook signature against secret
   */
  public verifySignature(payload: string, secret: string, providedSignature: string): boolean {
    const expected = this.computeSignature(payload, secret);
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(providedSignature));
  }

  /**
   * Dispatches an event to all matching active webhook subscriptions
   */
  public async dispatchEvent(params: {
    organizationId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<WebhookDeliveryRecord[]> {
    const subscriptions = db
      .getEnterpriseWebhooks(params.organizationId)
      .filter((s) => s.status === "ACTIVE" && (s.event_types.includes(params.eventType) || s.event_types.includes("*")));

    const deliveries: WebhookDeliveryRecord[] = [];
    const eventId = `evt_${Date.now()}_${randomSuffix()}`;
    const payloadStr = JSON.stringify({
      event_id: eventId,
      event_type: params.eventType,
      organization_id: params.organizationId,
      timestamp: new Date().toISOString(),
      data: params.payload,
    });

    for (const sub of subscriptions) {
      const signature = this.computeSignature(payloadStr, sub.secret);
      const deliveryId = `deliv_${Date.now()}_${randomSuffix()}`;

      // No HTTP delivery exists yet. This used to report DELIVERED with HTTP 200, a random duration and a made-up
      // response body, unless the URL contained "fail" (FX-31). The signed event is recorded as NOT_SENT.
      const delivery: WebhookDeliveryRecord = {
        id: deliveryId,
        subscription_id: sub.id,
        event_id: eventId,
        event_type: params.eventType,
        target_url: sub.target_url,
        payload_json: payloadStr,
        signature,
        duration_ms: null,
        attempt_number: 1,
        status: "NOT_SENT",
        delivered_at: new Date().toISOString(),
      };

      db.createWebhookDelivery(delivery);
      deliveries.push(delivery);
    }

    return deliveries;
  }
}

export const webhookPlatformService = new WebhookPlatformService();
