import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { OrderService } from "@/domains/orders/order.service";
import { IdempotencyService } from "@/domains/automation/services/idempotency.service";
import { BadRequestError } from "@/lib/errors";
import { withStore } from "@/lib/store-unit";

async function handlePOST(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string; action: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const action = params.action.toLowerCase();
    const idempotencyKey =
      request.headers.get("idempotency-key") ||
      request.headers.get("x-idempotency-key");

    if (!idempotencyKey) {
      throw new BadRequestError("Idempotency-Key header is strictly required for automated actions.");
    }

    const body = await request.json().catch(() => ({}));

    if (action === "confirm") {
      const { data, isCached } = await IdempotencyService.executeIdempotent(
        context.tenant.id,
        idempotencyKey,
        `AUTOMATION_ORDER_CONFIRM_${params.id}`,
        body,
        async () => {
          const updated = await OrderService.transitionOrderStatus(
            context,
            params.id,
            "CONFIRMED",
            body.reason || "Confirmed via n8n automation"
          );
          return { order: updated, confirmed: true, verified: true };
        }
      );

      return apiSuccess(data, { is_cached: isCached });
    }

    if (action === "cancel") {
      const { data, isCached } = await IdempotencyService.executeIdempotent(
        context.tenant.id,
        idempotencyKey,
        `AUTOMATION_ORDER_CANCEL_${params.id}`,
        body,
        async () => {
          const updated = await OrderService.transitionOrderStatus(
            context,
            params.id,
            "CANCELLED",
            body.reason || "Cancelled via n8n automation"
          );
          return { order: updated, cancelled: true, verified: true };
        }
      );

      return apiSuccess(data, { is_cached: isCached });
    }

    throw new BadRequestError(`Unsupported automated order action: '${params.action}'.`);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
