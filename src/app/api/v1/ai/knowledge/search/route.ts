import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { KnowledgeService } from "@/domains/ai/rag/knowledge.service";
import { AppError } from "@/lib/errors";
import { withStore } from "@/lib/store-unit";

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_KNOWLEDGE_READ);

    const body = await request.json();
    if (!body.query || typeof body.query !== "string") {
      throw new AppError("VALIDATION_ERROR", "Search query is required", 400);
    }

    const limit = typeof body.limit === "number" ? body.limit : 5;
    const threshold = typeof body.threshold === "number" ? body.threshold : 0.6;

    if (body.agentic || body.debug) {
      const agenticResult = await KnowledgeService.queryAgenticRag(
        context.tenant.id,
        body.query,
        { topK: limit, confidenceThresholdLow: threshold }
      );
      return apiSuccess(agenticResult, { query: body.query });
    }

    const results = await KnowledgeService.searchKnowledge(
      context.tenant.id,
      body.query,
      limit,
      threshold
    );

    return apiSuccess(results, { total: results.length, query: body.query });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
