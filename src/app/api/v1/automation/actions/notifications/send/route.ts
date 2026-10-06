import { z } from "zod";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { extractRequestContext, apiError } from "@/lib/api-response";
import { db } from "@/infrastructure/db";
import { BadRequestError, IntegrationNotConfiguredError, NotFoundError } from "@/lib/errors";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

/**
 * Automation notification action (called by n8n with a service token).
 *
 * It used to record `notification.sent` and answer `DELIVERED, verified: true` without sending anything, to any phone
 * number in the body (FX-99 Part A, audit F33). Now the recipient comes only from a record in this workspace (an
 * order's customer or a staff member), never from the body, and the action says plainly that nothing was sent: no
 * sending channel is wired for automations yet (WhatsApp Cloud is FX-50; automation sending is FX-99 Part B).
 */
const Body = z
  .object({
    channel: z.enum(["SMS", "WHATSAPP", "TELEGRAM", "EMAIL"]),
    template_code: z.string().min(1).max(100).optional(),
    message: z.string().min(1).max(1000).optional(),
    order_id: z.string().min(1).max(100).optional(),
    user_id: z.string().min(1).max(100).optional(),
  })
  .strict()
  .refine((b) => Boolean(b.order_id) !== Boolean(b.user_id), { message: "Give exactly one of order_id or user_id." })
  .refine((b) => Boolean(b.template_code || b.message), { message: "Give a template_code or a message." });

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.NOTIFICATIONS_SEND); // was unguarded (FX-18)
    const idempotencyKey = request.headers.get("idempotency-key") || request.headers.get("x-idempotency-key");
    if (!idempotencyKey) {
      throw new BadRequestError("Idempotency-Key header is strictly required for automated notifications.");
    }
    const body = parseOrThrow(Body, await readJson(request));

    // The recipient is resolved inside this workspace only
    if (body.order_id) {
      if (!db.findOrderById(context.tenant.id, body.order_id)) throw new NotFoundError("Order", body.order_id);
    } else if (body.user_id) {
      if (!db.findMembership(context.tenant.id, body.user_id)) throw new NotFoundError("Staff member", body.user_id);
    }

    throw new IntegrationNotConfiguredError(`Automation ${body.channel} notifications`, "no sending channel is wired for automations yet");
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
