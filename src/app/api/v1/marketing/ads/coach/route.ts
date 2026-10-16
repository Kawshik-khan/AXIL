import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { parseOrThrow, readJson } from "@/lib/validation";
import { InsightsCoachService } from "@/domains/social/insights/insights-coach.service";
import { withStore } from "@/lib/store-unit";
import { COMMERCE_ANALYTICS_COLLECTIONS } from "@/infrastructure/db/tenant-rows";

const Body = z.object({ days: z.union([z.literal(7), z.literal(14), z.literal(30), z.literal(90)]).default(30) }).strict();

/** AI advice over the server-built report; the model never supplies a metric. Writes nothing. */
async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_READ);
    RbacService.assertCan(context, PERMISSIONS.AI_RUN);
    await enforceRateLimit(`ai:user:${context.user.id}`, 30, MINUTE); // costly model calls (FX-14)
    const input = parseOrThrow(Body, await readJson(request));
    return apiSuccess(await InsightsCoachService.advise(context, "ads", input.days, request.signal));
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST, { tenantRows: { collections: COMMERCE_ANALYTICS_COLLECTIONS, permission: PERMISSIONS.MARKETING_READ } });
