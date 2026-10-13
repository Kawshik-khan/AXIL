import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformApprovalService } from "@/domains/platform/services/platform-approval.service";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

export const dynamic = "force-dynamic";

const Status = z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED", "EXECUTED", "EXPIRED"]);

/** Approval requests, newest first; `status` filters by the effective status (EXPIRED is derived). */
async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status");
    const status = statusParam ? Status.parse(statusParam) : undefined;
    const limitParam = Number(searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(limitParam) ? limitParam : 50;
    return apiSuccess(PlatformApprovalService.list(context, { status, limit }));
  } catch (error) {
    return apiError(error);
  }
}

// The target (type, id, label) is derived from the action and payload on the server, never taken from the client
const Body = z
  .object({
    action_key: z.string().min(1).max(100),
    payload: z.record(z.unknown()),
    reason: z.string().trim().min(10).max(1000),
    ticket_ref: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

/** Asks a second operator to approve one privileged action with this exact input. */
async function handlePOST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = parseOrThrow(Body, await readJson(request));
    const record = PlatformApprovalService.request(context, {
      actionKey: body.action_key,
      payload: body.payload,
      reason: body.reason,
      ticketRef: body.ticket_ref,
    });
    return apiSuccess(record, undefined, 201);
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
