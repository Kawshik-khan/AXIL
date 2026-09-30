import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { marketingService } from "@/domains/marketing/marketing.service";
import { withStore } from "@/lib/store-unit";

const RecoverSchema = z.object({
  order_id: z.string().min(1, "Order ID is required"),
});

async function handlePOST(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_WRITE);
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

export const POST = withStore("POST", handlePOST);
