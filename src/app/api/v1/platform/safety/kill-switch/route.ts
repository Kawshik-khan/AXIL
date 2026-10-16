import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformSafetyService } from "@/domains/platform";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    return apiSuccess(PlatformSafetyService.getKillSwitches(context));
  } catch (error) {
    return apiError(error);
  }
}

const Reason = z.string().trim().min(10, "Give a reason of at least 10 characters.").max(1000);
const Ticket = z.string().trim().min(1).max(100).optional();
const ApprovalId = z.string().trim().min(1).max(100).optional();

// Strict bodies (SA-5): previously the route destructured an unvalidated body
const Body = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("ACTIVATE"),
      scope: z.enum(["GLOBAL", "TENANT", "WORKFLOW", "PROVIDER", "CHANNEL"]),
      targetId: z.string().trim().min(1).max(200).optional(),
      reason: Reason,
      ticket_ref: Ticket,
      approval_id: ApprovalId,
      confirmation: z.string().max(100).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("DEACTIVATE"),
      id: z.string().trim().min(1).max(300),
      reason: Reason,
      ticket_ref: Ticket,
      approval_id: ApprovalId,
    })
    .strict(),
]);

/** Activates or deactivates a kill switch. Scoped: HIGH (step-up, ticket). GLOBAL: CRITICAL (two-person). */
async function handlePOST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = parseOrThrow(Body, await readJson(request));
    if (body.action === "DEACTIVATE") {
      return apiSuccess(
        PlatformSafetyService.deactivateKillSwitch(body.id, body.reason, context, {
          ticketRef: body.ticket_ref,
          approvalId: body.approval_id,
        })
      );
    }
    return apiSuccess(
      PlatformSafetyService.activateKillSwitch(
        {
          scope: body.scope,
          targetId: body.targetId,
          reason: body.reason,
          ticketRef: body.ticket_ref,
          approvalId: body.approval_id,
          confirmation: body.confirmation,
        },
        context
      )
    );
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
