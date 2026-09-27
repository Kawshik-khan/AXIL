import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformSupportService } from "@/domains/platform";

export async function GET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const sessions = PlatformSupportService.listSessions(context);
    return apiSuccess(sessions);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = await request.json();
    const result = await PlatformSupportService.startImpersonationSession(body, context);
    return apiSuccess(result, undefined, 201);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");
    const reason = searchParams.get("reason") || "Revoked by operator";

    if (!sessionId) {
      return apiError(new Error("sessionId parameter is required"), context.requestId);
    }

    const session = PlatformSupportService.revokeSession(sessionId, reason, context);
    return apiSuccess(session);
  } catch (error) {
    return apiError(error);
  }
}
