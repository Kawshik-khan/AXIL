/**
 * CommerceOS Phase 4: Knowledge Retrieval Tool
 * Semantic RAG retrieval strictly isolated to tenant store policies and guides.
 */

import { z } from "zod";
import { IAgentTool } from "../tool.interface";
import { ToolDefinition, ToolRiskLevel, RetrievalCitation } from "@/types/ai";
import { RequestContext } from "@/lib/context";
import { PERMISSIONS } from "@/lib/permissions";
import { KnowledgeService } from "@/domains/ai/rag/knowledge.service";

const SearchKnowledgeInputSchema = z.object({
  query: z.string().describe("Natural language question or search topic (Bangla, English, or Banglish)"),
  top_k: z.number().int().min(1).max(5).default(3),
});

export class SearchKnowledgeTool implements IAgentTool<z.infer<typeof SearchKnowledgeInputSchema>> {
  public readonly name = "search_knowledge";
  public readonly description = "Search store FAQs, return policy, delivery guidelines, size charts, and terms. Returns verified citations.";
  public readonly category = "KNOWLEDGE";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.AI_KNOWLEDGE_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = SearchKnowledgeInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          top_k: { type: "number", description: "Number of citations to retrieve" },
        },
        required: ["query"],
      },
      timeout_ms: 4000,
      idempotent: this.idempotent,
    };
  }

  public async execute(
    context: RequestContext,
    input: z.infer<typeof SearchKnowledgeInputSchema>
  ): Promise<RetrievalCitation[]> {
    // Execute Agentic RAG Controller (Hybrid BM25 + pgvector + Reranking + Parent-Child Chunking)
    return KnowledgeService.searchKnowledge(
      context.tenant.id,
      input.query,
      input.top_k || 3,
      0.60
    );
  }
}
