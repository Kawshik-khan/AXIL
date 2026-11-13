import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformBillingService } from "@/domains/platform";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

const Body = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

/** An operator could not find the transfer: the invoice becomes payable again and the workspace sees the reason. */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await extractPlatformContext(request);
    const { id } = await params;
    const { reason } = parseOrThrow(Body, await readJson(request));
    return apiSuccess({ invoice: PlatformBillingService.rejectManualPayment(context, id, reason) });
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withStore("POST", handlePOST);
