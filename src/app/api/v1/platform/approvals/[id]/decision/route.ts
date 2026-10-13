import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformApprovalService } from "@/domains/platform/services/platform-approval.service";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

const Body = z
  .object({
    decision: z.enum(["APPROVE", "REJECT"]),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

/** A second operator approves or rejects a request (approval.decide + the action's permission + step-up). */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await extractPlatformContext(request);
    const { id } = await params;
    const body = parseOrThrow(Body, await readJson(request));
    return apiSuccess(PlatformApprovalService.decide(context, id, body.decision, body.note));
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withStore("POST", handlePOST);
