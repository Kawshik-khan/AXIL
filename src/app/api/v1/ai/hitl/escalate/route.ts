import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { withStore } from "@/lib/store-unit";
import { HitlEscalationService } from "@/domains/ai/hitl/hitl-escalation.service";

const EscalateBody = z
  .object({
    conversation_id: z.string().min(1),
    reason: z.string().min(1),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
    customer_phone: z.string().optional(),
    order_draft: z
      .object({
        items: z.array(
          z.object({
            variant_id: z.string(),
            product_name: z.string(),
            quantity: z.number(),
            unit_price: z.number(),
            line_total: z.number(),
          })
        ),
        delivery_district: z.string(),
        subtotal: z.number(),
        delivery_fee: z.number(),
        grand_total: z.number(),
        payment_method: z.enum(["COD", "BKASH", "NAGAD"]),
      })
      .optional(),
  })
  .strict();

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.SUPPORT_WRITE);

    const body = EscalateBody.parse(await request.json());

    const escalation = HitlEscalationService.createEscalation({
      tenantId: context.tenant.id,
      conversationId: body.conversation_id,
      triggerReason: body.reason,
      priority: body.priority,
      customerPhone: body.customer_phone,
      orderDraft: body.order_draft,
    });

    return apiSuccess(escalation, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
