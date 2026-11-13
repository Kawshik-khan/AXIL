import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformBillingService } from "@/domains/platform";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

const Body = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

/** An operator found the transfer in the platform's own statement: the invoice is paid and the plan applies. */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await extractPlatformContext(request);
    const { id } = await params;
    const { reason } = parseOrThrow(Body, await readJson(request));
    return apiSuccess({ invoice: PlatformBillingService.verifyManualPayment(context, id, reason) });
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withStore("POST", handlePOST);
