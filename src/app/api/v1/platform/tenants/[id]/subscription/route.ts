import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformSubscriptionService } from "@/domains/platform/services/platform-subscription.service";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

const Reason = z.string().trim().min(10, "Give a reason of at least 10 characters.").max(1000);

const Body = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("CHANGE_PLAN"),
      plan_id: z.string().trim().min(1).max(40),
      billing_period: z.enum(["MONTHLY", "ANNUAL"]).optional(),
      end_trial: z.boolean().optional(),
      reason: Reason,
    })
    .strict(),
  z.object({ action: z.literal("START_TRIAL"), plan_id: z.string().trim().min(1).max(40), reason: Reason }).strict(),
  z.object({ action: z.literal("EXTEND_TRIAL"), trial_ends_at: z.string().datetime(), reason: Reason }).strict(),
]);

/** Subscription changes for the tenant in the path: change plan, start a trial, extend a trial (all MEDIUM). */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await extractPlatformContext(request);
    const { id } = await params;
    const body = parseOrThrow(Body, await readJson(request));
    switch (body.action) {
      case "CHANGE_PLAN":
        return apiSuccess(
          PlatformSubscriptionService.changeTenantPlan(id, body.plan_id, body.reason, context, {
            billingPeriod: body.billing_period,
            endTrial: body.end_trial,
          })
        );
      case "START_TRIAL":
        return apiSuccess(PlatformSubscriptionService.startTrial(context, id, body.plan_id, body.reason));
      case "EXTEND_TRIAL":
        return apiSuccess(PlatformSubscriptionService.extendTrial(context, id, body.trial_ends_at, body.reason));
    }
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withStore("POST", handlePOST);
