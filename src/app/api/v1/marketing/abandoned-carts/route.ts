import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { marketingService } from "@/domains/marketing/marketing.service";

const CreateCartSchema = z.object({
  customer_id: z.string().min(1, "Customer ID is required"),
  cart_items: z.array(
    z.object({
      product_id: z.string(),
      title: z.string(),
      price: z.number().positive(),
      quantity: z.number().int().positive(),
    })
  ).min(1, "At least one cart item is required"),
  abandoned_at: z.string().optional(),
});

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_READ);
    const carts = marketingService.getAbandonedCarts(context.tenant.id);
    return apiSuccess({ carts, total: carts.length });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_WRITE);
    const body = await request.json();
    const validated = CreateCartSchema.parse(body);

    const cart = marketingService.recordAbandonedCart({
      tenantId: context.tenant.id,
      customerId: validated.customer_id,
      cartItems: validated.cart_items,
      abandonedAt: validated.abandoned_at,
    });

    return apiSuccess({ cart }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
