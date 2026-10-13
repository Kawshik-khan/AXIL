import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformImpactService } from "@/domains/platform/services/platform-impact.service";
import { parseOrThrow } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

export const dynamic = "force-dynamic";

const Query = z.object({
  action: z.string().min(1).max(100),
  scope: z.enum(["GLOBAL", "TENANT", "WORKFLOW", "PROVIDER", "CHANNEL"]).optional(),
  target: z.string().min(1).max(200).optional(),
});

/** What a privileged action would touch, counted now (read-only; never stored). */
async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const params = new URL(request.url).searchParams;
    const q = parseOrThrow(Query, {
      action: params.get("action") ?? undefined,
      scope: params.get("scope") ?? undefined,
      target: params.get("target") ?? undefined,
    });
    return apiSuccess(PlatformImpactService.preview(context, q.action, q.scope ?? null, q.target ?? null));
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
