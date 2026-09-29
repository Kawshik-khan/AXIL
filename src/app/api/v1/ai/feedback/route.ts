import { randomSuffix } from "@/lib/ids";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";
import { AppError } from "@/lib/errors";
import { AIFeedbackRecord } from "@/types/ai";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_FEEDBACK);

    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("run_id") || undefined;
    const rating = searchParams.get("rating") || undefined;

    const feedback = db.getAIFeedback(context.tenant.id, { runId, rating });
    return apiSuccess(feedback, { total: feedback.length });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_FEEDBACK);

    const body = await request.json();
    if (!body.agent_run_id || !body.rating) {
      throw new AppError("VALIDATION_ERROR", "agent_run_id and rating (THUMBS_UP / THUMBS_DOWN) are required", 400);
    }

    const newFeedback: AIFeedbackRecord = {
      id: `fb_${Date.now()}_${randomSuffix()}`,
      tenant_id: context.tenant.id,
      agent_run_id: body.agent_run_id,
      conversation_id: body.conversation_id || "",
      message_id: body.message_id || "",
      user_id: context.user.id,
      rating: body.rating,
      reason: body.comment || body.reason,
      operator_corrected_reply: body.corrected_response || body.operator_corrected_reply,
      created_at: new Date().toISOString(),
    };

    const saved = db.createAIFeedback(newFeedback);
    return apiSuccess(saved, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
