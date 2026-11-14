import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { OnboardingService, OnboardingUpdateSchema } from "@/domains/onboarding/onboarding.service";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

/** Onboarding progress, the answers so far and the launch checklist (computed from real data). Read-only. */
async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    return apiSuccess(await OnboardingService.getStatus(context));
  } catch (err) {
    return apiError(err);
  }
}

/** Saves onboarding answers and progress (settings.update). Tenant comes from the session only. */
async function handlePATCH(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const input = parseOrThrow(OnboardingUpdateSchema, await readJson(request));
    return apiSuccess(await OnboardingService.update(context, input));
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const PATCH = withStore("PATCH", handlePATCH);
