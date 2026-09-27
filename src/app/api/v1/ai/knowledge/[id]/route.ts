import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { KnowledgeService } from "@/domains/ai/rag/knowledge.service";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const result = await KnowledgeService.getDocumentById(context, params.id);
    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    await KnowledgeService.deleteDocument(context, params.id);
    return apiSuccess({ deleted: true, id: params.id });
  } catch (err) {
    return apiError(err);
  }
}
