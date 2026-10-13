import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { withStore } from "@/lib/store-unit";
import { db } from "@/infrastructure/db";
import { NotFoundError } from "@/lib/errors";
import { RtoScoringService } from "@/domains/rto/rto-scoring.service";
import { orderRepository } from "@/domains/orders/order.repository";

interface RouteParams {
  params: Promise<{ orderId: string }>;
}

async function handleGET(request: Request, { params }: RouteParams) {
  try {
    const ctx = await extractRequestContext(request);
    RbacService.assertCan(ctx, PERMISSIONS.ORDERS_READ);

    // A Promise in this Next.js version: read synchronously, the id was undefined and every order "not found"
    const { orderId } = await params;
    const order = await orderRepository.findById(ctx.tenant.id, orderId);
    if (!order) {
      throw new NotFoundError("Order", orderId);
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
