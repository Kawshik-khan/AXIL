import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { KnowledgeService } from "@/domains/ai/rag/knowledge.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const result = await KnowledgeService.getDocumentById(context, params.id);
    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}

async function handleDELETE(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    await KnowledgeService.deleteDocument(context, params.id);
    return apiSuccess({ deleted: true, id: params.id });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const DELETE = withStore("DELETE", handleDELETE);
