import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { parseOrThrow } from "@/lib/validation";
import { AgentRolloutService } from "@/domains/platform";
import { withStore } from "@/lib/store-unit";

const Query = z.object({ tenant_id: z.string().min(1).max(100).optional(), days: z.coerce.number().int().min(1).max(30).optional() }).strict();

/** Customer-agent rollout go/no-go numbers (FX-87), optionally for one workspace. Read-only, platform operators. */
async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const q = parseOrThrow(Query, Object.fromEntries(new URL(request.url).searchParams));
    return apiSuccess(AgentRolloutService.report(context, { tenantId: q.tenant_id, windowDays: q.days }));
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
