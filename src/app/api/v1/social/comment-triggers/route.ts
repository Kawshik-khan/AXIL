import { parseOrThrow, readJson } from "@/lib/validation";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { CommentTriggerCreateSchema, CommentTriggerService } from "@/domains/social/comment-triggers/comment-trigger.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    return apiSuccess({ triggers: CommentTriggerService.list(context) });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const input = parseOrThrow(CommentTriggerCreateSchema, await readJson(request));
    return apiSuccess({ trigger: CommentTriggerService.create(context, input) }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
