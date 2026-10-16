import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformTenantService } from "@/domains/platform";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

const Body = z.object({ reason: z.string().trim().min(10, "Give a reason of at least 10 characters.").max(1000) }).strict();

/** Reactivates the suspended tenant in the path (MEDIUM, reason required). */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await extractPlatformContext(request);
    const { id } = await params;
    const body = parseOrThrow(Body, await readJson(request));
    return apiSuccess(PlatformTenantService.activateTenant(id, body.reason, context));
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withStore("POST", handlePOST);
