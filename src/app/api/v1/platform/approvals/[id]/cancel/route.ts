import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformApprovalService } from "@/domains/platform/services/platform-approval.service";
import { withStore } from "@/lib/store-unit";

/** Withdraws a request that has not run (the requester, or an operator who can decide approvals). */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await extractPlatformContext(request);
    const { id } = await params;
    return apiSuccess(PlatformApprovalService.cancel(context, id));
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withStore("POST", handlePOST);
