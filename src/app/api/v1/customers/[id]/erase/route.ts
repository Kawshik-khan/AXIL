import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { parseOrThrow, readJson } from "@/lib/validation";
import { requireStepUpAlways } from "@/lib/step-up";
import { CustomerErasureService } from "@/domains/privacy/customer-erasure.service";
import { withStore } from "@/lib/store-unit";

/** Typed confirmation (erasure can't be undone) and a reason for the audit log. */
const Body = z.object({ confirm: z.literal("ERASE"), reason: z.string().trim().min(5).max(300) }).strict();

/**
 * Erases a customer's personal data in this workspace (FX-83). Workspace owner, always with a fresh authenticator code
 * (no grace period: this can't be undone).
 */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.CUSTOMERS_ERASE);
    requireStepUpAlways(context, "CUSTOMER_ERASE");
    const { reason } = parseOrThrow(Body, await readJson(request));
    const { id } = await params;
    return apiSuccess(CustomerErasureService.erase(context, id, reason));
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
