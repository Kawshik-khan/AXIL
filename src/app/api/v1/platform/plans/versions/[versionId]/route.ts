import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformPlanService } from "@/domains/platform/services/platform-plan.service";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

const Body = z
  .object({
    action: z.enum(["PUBLISH", "RETIRE"]),
    reason: z.string().trim().min(10).max(1000),
  })
  .strict();

/** Publishes a draft (new subscribers get it) or retires a published version (no new sign-ups). MEDIUM. */
async function handlePOST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  try {
    const context = await extractPlatformContext(request);
    const { versionId } = await params;
    const body = parseOrThrow(Body, await readJson(request));
    return apiSuccess(
      body.action === "PUBLISH"
        ? PlatformPlanService.publishVersion(context, versionId, body.reason)
        : PlatformPlanService.retireVersion(context, versionId, body.reason)
    );
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withStore("POST", handlePOST);
