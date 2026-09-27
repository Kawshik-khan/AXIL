import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const res = apiSuccess({
      user: context.platformUser,
      role: context.platformRole,
      permissions: context.permissions,
      mfaVerified: context.mfaVerified,
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
