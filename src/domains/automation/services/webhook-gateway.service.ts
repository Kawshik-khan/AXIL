/**
 * CommerceOS Phase 6: Webhook Gateway & Cryptographic Verification Service
 * Handles cryptographic signature verification, replay protection, timestamp drift validation,
 * payload normalization, and secure delivery tracking for all inbound partner webhooks.
 */

import crypto from "crypto";
import { db } from "@/infrastructure/db";
import {
  AutomationWebhook,
  AutomationWebhookDelivery,
  WebhookProvider,
  WebhookSignatureAlgorithm,
} from "@/types/automation";
import { IdempotencyService } from "./idempotency.service";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export interface InboundWebhookRequest {
  provider: WebhookProvider;
  endpointPath: string;
  headers: Record<string, string>;
  rawBody: string;
  parsedBody: Record<string, unknown>;
  /** The configured webhook row this request targets (resolved from the public `?wh=` identifier). */
  webhookId?: string;
}

export interface WebhookVerificationResult {
  verified: boolean;
  code: "SUCCESS" | "INVALID_SIGNATURE" | "EXPIRED_TIMESTAMP" | "REPLAY_ATTACK" | "UNKNOWN_WEBHOOK" | "INVALID_PAYLOAD";
  reason?: string;
  webhook?: AutomationWebhook;
  deliveryId: string;
}

export class WebhookGatewayService {
  private static readonly MAX_TIMESTAMP_DRIFT_SECONDS = 300; // 5 minutes

  private static readonly MIN_SECRET_LENGTH = 24;

  /**
   * Resolves the webhook's HMAC secret from the environment variable named by `secret_reference`.
   * There is no fallback: a missing or short secret makes the webhook unusable (audit C4).
   */
  public static resolveWebhookSecret(secretReference: string): string {
    const value = process.env[secretReference];
    if (!value || value.length < this.MIN_SECRET_LENGTH) {
      throw new AppError(
        "WEBHOOK_SECRET_MISSING",
        `Webhook secret ${secretReference} is not configured (needs at least ${this.MIN_SECRET_LENGTH} characters).`,
        503
      );
    }
    return value;
  }

  /**
   * Server-side lookup of the webhook row an inbound request targets, by its public id and provider.
   * Only active rows qualify; the row's tenant is the only tenant the request can affect.
   */
  public static findIngressWebhook(webhookId: string, provider: WebhookProvider): AutomationWebhook | undefined {
    return db.findActiveAutomationWebhookForIngress(webhookId, provider);
  }

  /**
   * Computes expected cryptographic HMAC signature
   */
  public static computeSignature(
    payload: string,
    secret: string,
    algorithm: WebhookSignatureAlgorithm
  ): string {
    const algoName = algorithm === "HMAC_SHA512" ? "sha512" : "sha256";
    return crypto.createHmac(algoName, secret).update(payload).digest("hex");
  }

  /**
   * Performs constant-time comparison to prevent timing attacks
   */
  public static verifyConstantTime(expected: string, received: string): boolean {
    if (!expected || !received) return false;
    const bufExpected = Buffer.from(expected.trim().toLowerCase());
    const bufReceived = Buffer.from(received.trim().toLowerCase());
    if (bufExpected.length !== bufReceived.length) return false;
    return crypto.timingSafeEqual(bufExpected, bufReceived);
  }

  /**
   * Validates inbound webhook authenticity, timestamp, and replay safety
   */
  public static async processInboundWebhook(
    tenantId: string,
    req: InboundWebhookRequest
  ): Promise<WebhookVerificationResult> {
    const deliveryId = `whd_${crypto.randomUUID()}`;
    const payloadSize = Buffer.byteLength(req.rawBody || "", "utf8");

    // 1. Find the configured webhook definition (never auto-created — audit C4)
    const webhook = req.webhookId
      ? db.findAutomationWebhookById(tenantId, req.webhookId)
      : db.findAutomationWebhookByProvider(tenantId, req.provider);
    if (!webhook || !webhook.is_active || webhook.provider !== req.provider) {
      db.createAutomationWebhookDelivery({
        id: deliveryId,
        tenant_id: tenantId,
        webhook_id: "unknown",
        provider: req.provider,
        status: "REJECTED",
        failure_reason: `No active webhook configured for provider ${req.provider}`,
        payload_size_bytes: payloadSize,
        timestamp: new Date().toISOString(),
      });

      return {
        verified: false,
        code: "UNKNOWN_WEBHOOK",
        reason: `Webhook configuration not found for provider ${req.provider}`,
        deliveryId,
      };
    }

    const rejectDelivery = (
      code: WebhookVerificationResult["code"],
      reason: string,
      signature?: string
    ): WebhookVerificationResult => {
      db.createAutomationWebhookDelivery({
        id: deliveryId,
        tenant_id: tenantId,
        webhook_id: webhook.id,
        provider: req.provider,
        ...(signature ? { signature } : {}),
        status: "REJECTED",
        failure_reason: reason,
        payload_size_bytes: payloadSize,
        timestamp: new Date().toISOString(),
      });
      return { verified: false, code, reason, webhook, deliveryId };
    };

    // 2. Timestamp is mandatory and must be fresh (replay protection step 1, rules/security.md §4).
    const timestampHeader =
      req.headers["x-webhook-timestamp"] ||
      req.headers["x-signature-timestamp"] ||
      req.headers["timestamp"] ||
      req.headers["x-meta-timestamp"];
    const timestampValue = Number(timestampHeader);
    if (!timestampHeader || !Number.isFinite(timestampValue)) {
      return rejectDelivery("EXPIRED_TIMESTAMP", "Missing or invalid webhook timestamp header.");
    }
    const parsedTime = timestampValue > 1e11 ? timestampValue : timestampValue * 1000;
    const driftSeconds = Math.abs(Date.now() - parsedTime) / 1000;
    if (driftSeconds > this.MAX_TIMESTAMP_DRIFT_SECONDS) {
      return rejectDelivery(
        "EXPIRED_TIMESTAMP",
        `Timestamp drift of ${Math.round(driftSeconds)}s exceeds maximum allowed ${this.MAX_TIMESTAMP_DRIFT_SECONDS}s`
      );
    }

    // 3. HMAC signature over the raw body is mandatory for every webhook. Legacy rows marked "TOKEN" (or
    //    unsupported algorithms) are verified as HMAC-SHA256; an Authorization header never replaces the
    //    signature (audit C4, ADR-103).
    const signatureHeader =
      req.headers["x-signature"] ||
      req.headers["x-webhook-signature"] ||
      req.headers["x-hub-signature-256"] ||
      req.headers["x-provider-signature"];
    if (!signatureHeader) {
      return rejectDelivery("INVALID_SIGNATURE", "Missing signature header in webhook request.");
    }

    let secret: string;
    try {
      secret = this.resolveWebhookSecret(webhook.secret_reference);
    } catch {
      logger.error("webhook.secret_missing", { tenant_id: tenantId, webhook_id: webhook.id, secret_reference: webhook.secret_reference });
      return rejectDelivery("UNKNOWN_WEBHOOK", "Webhook secret is not configured.");
    }

    const algorithm: WebhookSignatureAlgorithm = webhook.signature_algorithm === "HMAC_SHA512" ? "HMAC_SHA512" : "HMAC_SHA256";
    const cleanSignature = signatureHeader.replace(/^sha256=|^sha512=/i, "");
    // Accept a signature over "<timestamp>.<rawBody>" (preferred: binds the timestamp) or over the raw body.
    const expectedSigTimestamped = this.computeSignature(`${timestampHeader}.${req.rawBody}`, secret, algorithm);
    const expectedSigRaw = this.computeSignature(req.rawBody, secret, algorithm);
    const isValid =
      this.verifyConstantTime(expectedSigTimestamped, cleanSignature) ||
      this.verifyConstantTime(expectedSigRaw, cleanSignature);
    if (!isValid) {
      return rejectDelivery("INVALID_SIGNATURE", "Invalid webhook cryptographic signature.", signatureHeader);
    }

    // 4. Provider event ID replay check (Replay protection step 2)
    const providerEventId =
      (req.parsedBody.event_id as string) ||
      (req.parsedBody.id as string) ||
      (req.headers["x-event-id"] as string) ||
      req.headers["x-request-id"];

    if (providerEventId) {
      const idempotencyKey = `wh_${req.provider}_${providerEventId}`;
      const lock = IdempotencyService.acquireLock(tenantId, idempotencyKey, "WEBHOOK_INGESTION", req.parsedBody);
      if (lock.isDuplicate && lock.status === "COMPLETED") {
        db.createAutomationWebhookDelivery({
          id: deliveryId,
          tenant_id: tenantId,
          webhook_id: webhook.id,
          provider: req.provider,
          provider_event_id: providerEventId,
          status: "PROCESSED",
          failure_reason: "Duplicate event suppressed via idempotency",
          payload_size_bytes: payloadSize,
          timestamp: new Date().toISOString(),
        });

        return {
          verified: true,
          code: "SUCCESS",
          reason: "Duplicate event already processed.",
          webhook,
          deliveryId,
        };
      }
    }

    // 5. Success delivery logging
    db.createAutomationWebhookDelivery({
      id: deliveryId,
      tenant_id: tenantId,
      webhook_id: webhook.id,
      provider: req.provider,
      provider_event_id: providerEventId,
      signature: signatureHeader,
      status: "VERIFIED",
      payload_size_bytes: payloadSize,
      timestamp: new Date().toISOString(),
    });

    db.updateAutomationWebhook(tenantId, webhook.id, {
      last_event_at: new Date().toISOString(),
    });

    return {
      verified: true,
      code: "SUCCESS",
      webhook,
      deliveryId,
    };
  }
}
