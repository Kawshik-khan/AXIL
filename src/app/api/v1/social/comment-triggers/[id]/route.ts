import { parseOrThrow, readJson } from "@/lib/validation";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { CommentTriggerService, CommentTriggerUpdateSchema } from "@/domains/social/comment-triggers/comment-trigger.service";
import { withStore } from "@/lib/store-unit";

async function handlePATCH(request: Request, { params: rawParams }: { params: Promise<{ id: string }> }) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const input = parseOrThrow(CommentTriggerUpdateSchema, await readJson(request));
    return apiSuccess({ trigger: CommentTriggerService.update(context, params.id, input) });
  } catch (err) {
    return apiError(err);
  }
}

async function handleDELETE(request: Request, { params: rawParams }: { params: Promise<{ id: string }> }) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    return apiSuccess(CommentTriggerService.remove(context, params.id));
  } catch (err) {
    return apiError(err);
  }
}

export const PATCH = withStore("PATCH", handlePATCH);
export const DELETE = withStore("DELETE", handleDELETE);
