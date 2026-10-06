import { z } from "zod";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { pricingOperationsService } from "@/domains/operations/services/pricing-operations.service";
import { procurementService } from "@/domains/operations/services/procurement.service";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

// Strict body (ADR-104): `approved` is a real boolean, and only action types this route handles are accepted. An
// unknown type used to answer "APPROVED" while doing nothing (FX-68 security review).
const Body = z
  .object({
    action_type: z.enum(["PRICE_CHANGE", "PURCHASE_ORDER"]),
    approved: z.boolean(),
    reason: z.string().max(500).optional(),
  })
  .strict();

async function handlePOST(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.OPERATIONS_APPROVE);
    const tenantId = context.tenant.id;
    const actionId = params.id;
    const { action_type, approved, reason } = parseOrThrow(Body, await readJson(request));

    let result: unknown;

    if (action_type === "PRICE_CHANGE") {
      // A rejection is saved, so the change can't be executed later by a retry or a second approval
      result = approved
        ? pricingOperationsService.executePriceChange(tenantId, actionId, context.user.id, { actorType: "USER", approvedNow: true })
        : pricingOperationsService.rejectPriceChange(tenantId, actionId, context.user.id, reason);
    } else {
      result = approved
        ? procurementService.transitionPurchaseOrderStatus(tenantId, actionId, "APPROVED", context.user.id)
        : procurementService.transitionPurchaseOrderStatus(tenantId, actionId, "CANCELLED", context.user.id);
    }

    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
