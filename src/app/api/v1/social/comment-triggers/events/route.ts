import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { CommentTriggerService } from "@/domains/social/comment-triggers/comment-trigger.service";
import { withStore } from "@/lib/store-unit";

/** Recent matched comments and what happened to each inbox message (read-only). */
async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
    return apiSuccess({ events: CommentTriggerService.recentEvents(context, Number.isFinite(limit) ? limit : 50) });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
