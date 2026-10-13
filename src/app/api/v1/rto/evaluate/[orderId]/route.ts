import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { withStore } from "@/lib/store-unit";
import { db } from "@/infrastructure/db";
import { NotFoundError } from "@/lib/errors";
import { RtoScoringService } from "@/domains/rto/rto-scoring.service";
import { orderRepository } from "@/domains/orders/order.repository";

interface RouteParams {
  params: { orderId: string };
}

async function handleGET(request: Request, { params }: RouteParams) {
  try {
    const ctx = await extractRequestContext(request);
    RbacService.assertCan(ctx, PERMISSIONS.ORDERS_READ);

    const order = await orderRepository.findById(ctx.tenant.id, params.orderId);
    if (!order) {
      throw new NotFoundError("Order", params.orderId);
    }

    let evaluation = db.findOrderRtoEvaluation(ctx.tenant.id, order.id);
    if (!evaluation) {
      // Evaluate on-demand if not already evaluated (strictly read-only in GET handler)
      evaluation = await RtoScoringService.evaluateOrderRisk(ctx, order, undefined, { persist: false });
    }

    return apiSuccess(evaluation);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
