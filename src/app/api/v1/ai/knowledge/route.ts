import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { KnowledgeService } from "@/domains/ai/rag/knowledge.service";
import { AppError } from "@/lib/errors";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const docs = await KnowledgeService.listDocuments(context);
    return apiSuccess(docs, { total: docs.length });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);

    const body = await request.json();
    if (!body.title || !body.raw_content) {
      throw new AppError("VALIDATION_ERROR", "Title and raw_content are required", 400);
    }

    const doc = await KnowledgeService.ingestDocument(context, {
      title: body.title,
      document_type: body.document_type || "RETURN_POLICY",
      raw_content: body.raw_content,
      file_format: body.file_format || "MARKDOWN",
      tags: body.tags,
      language: body.language,
    });

    return apiSuccess(doc, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
