import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { randomSuffix } from "@/lib/ids";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { IdempotencyService } from "@/domains/automation/services/idempotency.service";
import { db } from "@/infrastructure/db";
import { BadRequestError } from "@/lib/errors";

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.NOTIFICATIONS_SEND); // was unguarded (FX-18)
    const idempotencyKey =
      request.headers.get("idempotency-key") ||
      request.headers.get("x-idempotency-key");

    if (!idempotencyKey) {
      throw new BadRequestError("Idempotency-Key header is strictly required for automated notifications.");
    }

    const correlationId = request.headers.get("x-correlation-id") || `corr_${Date.now()}_${randomSuffix()}`;
    const causationId = request.headers.get("x-causation-id") || undefined;
    const body = await request.json();

    const { data, isCached } = await IdempotencyService.executeIdempotent(
      context.tenant.id,
      idempotencyKey,
      "AUTOMATION_NOTIFICATION_SEND",
      body,
      async () => {
        const notifId = `notif_${Date.now()}_${randomSuffix()}`;
        const now = new Date().toISOString();

        // Authoritative validation
        const channel = body.channel || "SMS";
        const recipient = body.recipient || body.customer_phone || body.operator_phone;
        const message = body.message || body.body || `Order update notification for ${body.order_number || body.order_id}`;

        if (!recipient) {
          throw new BadRequestError("Recipient phone number or email is required for notification.");
        }

        // Record canonical domain event
        db.recordEvent({
          id: `evt_notif_${Date.now()}_${randomSuffix()}`,
          type: "notification.sent",
          version: "1.0",
          tenant_id: context.tenant.id,
          aggregate_type: "notification",
          aggregate_id: notifId,
          actor_id: context.user.id,
          correlation_id: correlationId,
          timestamp: now,
          payload: {
            notification_id: notifId,
            channel,
            recipient,
            template_code: body.template_code,
            order_id: body.order_id,
          },
        });

        // Audit log
        db.createAutomationAuditLog({
          id: `aud_notif_${Date.now()}_${randomSuffix()}`,
          tenant_id: context.tenant.id,
          actor_id: context.user.id,
          action: "NOTIFICATION_DISPATCHED",
          resource_type: "notification",
          resource_id: notifId,
          metadata: { channel, recipient, correlation_id: correlationId },
          timestamp: now,
        });

        return {
          notification_id: notifId,
          recipient,
          channel,
          status: "DELIVERED",
          verified: true,
          correlation_id: correlationId,
          causation_id: causationId,
          timestamp: now,
        };
      }
    );

    return apiSuccess(data, { is_cached: isCached });
  } catch (err) {
    return apiError(err);
  }
}
