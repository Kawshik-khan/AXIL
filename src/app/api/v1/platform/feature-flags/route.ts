import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformFeatureFlagService } from "@/domains/platform";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    return apiSuccess(PlatformFeatureFlagService.listFlags(context));
  } catch (error) {
    return apiError(error);
  }
}

const Body = z
  .object({
    key: z.string().trim().regex(/^[a-z0-9][a-z0-9_.-]{1,79}$/, "Use lowercase letters, digits, dots, dashes or underscores."),
    description: z.string().trim().min(1).max(300),
    is_enabled_globally: z.boolean(),
    percentage_rollout: z.number().int().min(0).max(100),
    tenant_allowlist: z.array(z.string().min(1).max(100)).max(1000).default([]),
    reason: z.string().trim().min(10).max(1000),
  })
  .strict();

/** Creates or updates a flag (MEDIUM). Evaluated by src/lib/safety-gate.ts isFeatureEnabled. */
async function handlePOST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = parseOrThrow(Body, await readJson(request));
    const flag = PlatformFeatureFlagService.saveFlag(
      {
        key: body.key,
        description: body.description,
        is_enabled_globally: body.is_enabled_globally,
        percentage_rollout: body.percentage_rollout,
        tenant_allowlist: body.tenant_allowlist,
      },
      body.reason,
      context
    );
    return apiSuccess(flag);
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
