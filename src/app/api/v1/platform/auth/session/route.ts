import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { withStore } from "@/lib/store-unit";
import { PlatformMfaService } from "@/domains/platform/services/platform-mfa.service";

export const dynamic = "force-dynamic";

async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const res = apiSuccess({
      user: context.platformUser,
      role: context.platformRole,
      permissions: context.permissions,
      mfaVerified: context.mfaVerified,
      // Whether this operator has an authenticator set up (the console offers setup when false). Read-only.
      mfaEnrolled: PlatformMfaService.isEnrolled(context.platformUser.id),
      stepUpVerified: context.stepUpVerified,
      scope: context.scope,
    });
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return res;
  } catch (error) {
    const errRes = apiError(error);
    errRes.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return errRes;
  }
}

export const GET = withStore("GET", handleGET);
