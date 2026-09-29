import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { KnowledgeService } from "@/domains/ai/rag/knowledge.service";
import { withStore } from "@/lib/store-unit";

async function handlePOST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_KNOWLEDGE_MANAGE);

    const doc = await KnowledgeService.reindexDocument(context, params.id);
    return apiSuccess(doc);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
