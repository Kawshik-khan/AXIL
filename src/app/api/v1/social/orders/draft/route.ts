import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { SocialOrderService } from "@/domains/social/commerce-integration/social-order.service";

const DraftBody = z
  .object({
    conversation_id: z.string().min(1),
    items: z.array(z.object({ variant_id: z.string().min(1), quantity: z.number().int().positive() }).strict()).min(1),
    delivery_address: z
      .object({
        division: z.string().optional(),
        district: z.string().trim().min(1),
        upazila: z.string().optional(),
        area: z.string().optional(),
        address_line_1: z.string().trim().min(1),
        postal_code: z.string().optional(),
      })
      .strict(),
    delivery_zone: z.enum(["INSIDE_DHAKA", "OUTSIDE_DHAKA"]).optional(), // derived from the district on the server
    payment_method: z.enum(["COD", "BKASH", "NAGAD", "ROCKET", "CARD"]),
    coupon_code: z.string().trim().min(1).optional(),
    notes: z.string().max(2000).optional(),
    /** Needed when the social customer has no phone yet (identity resolution no longer invents one). */
    customer_phone: z.string().trim().min(6).optional(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = DraftBody.parse(await request.json());

    const order = await SocialOrderService.createOrderFromConversation(context, body);
    return apiSuccess({ order }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
