import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformBillingService } from "@/domains/platform";
import { parseOrThrow } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

const Status = z.enum(["ISSUED", "PENDING_VERIFICATION", "PAID", "VOID"]);

/** Every workspace's subscription invoices, newest first; `?status=PENDING_VERIFICATION` is the review queue. */
async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const raw = new URL(request.url).searchParams.get("status");
    const status = raw ? parseOrThrow(Status, raw) : undefined;
    return apiSuccess({ invoices: PlatformBillingService.listInvoices(context, { status }) });
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
