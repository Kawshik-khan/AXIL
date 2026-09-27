import { extractPlatformContext, apiSuccess, apiError } from "@/lib/api-response";
import { db } from "@/infrastructure/db";
import { logger } from "@/lib/logger";
import { PLATFORM_AUTH_COOKIE_NAME } from "@/lib/security";

/** "Sign out everywhere" for platform operators: revokes every session of this account (FX-15). */
export async function POST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    db.bumpSessionVersion(context.platformUser.id);
    logger.info("platform.sessions_revoked", { user_id: context.platformUser.id });
    const response = apiSuccess({ message: "Signed out of every session." });
    response.cookies.delete(PLATFORM_AUTH_COOKIE_NAME);
    return response;
  } catch (err) {
    return apiError(err);
  }
}
