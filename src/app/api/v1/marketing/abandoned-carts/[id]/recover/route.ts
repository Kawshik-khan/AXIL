import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { marketingService } from "@/domains/marketing/marketing.service";

const RecoverSchema = z.object({
  order_id: z.string().min(1, "Order ID is required"),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();
    const validated = RecoverSchema.parse(body);

    const cart = marketingService.markCartRecovered({
      tenantId: context.tenant.id,
      cartId: params.id,
      orderId: validated.order_id,
    });

    return apiSuccess({ cart });
  } catch (err) {
    return apiError(err);
  }
}
