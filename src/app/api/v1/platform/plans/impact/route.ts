import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformPlanService } from "@/domains/platform/services/platform-plan.service";
import { parseOrThrow } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

export const dynamic = "force-dynamic";

const Query = z.object({
  from_version_id: z.string().min(1).max(100),
  to_version_id: z.string().min(1).max(100),
  targets: z.string().max(10_000).optional(),
});

/** Read-only preview of moving tenants between plan versions: who is affected, limits they'd exceed, MRR change. */
async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const { searchParams } = new URL(request.url);
    const q = parseOrThrow(Query, {
      from_version_id: searchParams.get("from_version_id") ?? undefined,
      to_version_id: searchParams.get("to_version_id") ?? undefined,
      targets: searchParams.get("targets") ?? undefined,
    });
    const targets = q.targets ? q.targets.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
    return apiSuccess(await PlatformPlanService.migrationImpact(context, q.from_version_id, q.to_version_id, targets));
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
