/**
 * CommerceOS: Hierarchical Parent-Child Chunking Service
 *
 * Implements two-tier document segmentation:
 * 1. Parent Chunks (800-1200 tokens): Rich, comprehensive context preservation (tables, sections).
 * 2. Child Chunks (150-250 tokens): Fine-grained granular units for high-precision Vector and BM25 indexing.
 */

import { KnowledgeChunk, KnowledgeDocumentType } from "@/types/ai";
import { BM25Service } from "./bm25.service";

export interface HierarchicalChunkResult {
  parentChunks: KnowledgeChunk[];
  childChunks: KnowledgeChunk[];
  totalParentCount: number;
  totalChildCount: number;
}

export class ParentChildChunkingService {
  // Parent chunk limits: ~800 to 1200 tokens (3200 to 4800 chars)
  private static readonly TARGET_PARENT_CHARS = 3600;
  private static readonly MAX_PARENT_CHARS = 5200;

  // Child chunk limits: ~100 to 200 tokens (400 to 800 chars)
  private static readonly TARGET_CHILD_CHARS = 450;
  private static readonly MAX_CHILD_CHARS = 850;
  private static readonly CHILD_OVERLAP_CHARS = 100;

  /**
   * Decomposes raw document text into hierarchical Parent and Child chunks.
   */
  public static chunkDocumentHierarchically(
    tenantId: string,
    documentId: string,
    rawContent: string,
    metadata: {
      document_title: string;
      document_type: KnowledgeDocumentType;
      version: number;
      language?: string;
    }
  ): HierarchicalChunkResult {
    if (!rawContent || !rawContent.trim()) {
      return { parentChunks: [], childChunks: [], totalParentCount: 0, totalChildCount: 0 };
    }

    const lang = metadata.language || "mixed";
    const now = new Date().toISOString();

    // 1. Group into logical sections based on markdown headings
    const sections = this.splitIntoSections(rawContent, metadata.document_title);

    // 2. Build Parent Chunks from sections
    const rawParents: Array<{ id: string; index: number; heading: string; content: string }> = [];
    let parentIndex = 0;

    for (const section of sections) {
      if (section.content.length <= this.MAX_PARENT_CHARS) {
        rawParents.push({
          id: `kchk_parent_${documentId}_${parentIndex}`,
          index: parentIndex++,
          heading: section.heading,
          content: section.content.trim(),
        });
      } else {
        // Subdivide giant section into multiple parent chunks
        const subParents = this.splitTextByParagraphs(
          section.content,
          this.TARGET_PARENT_CHARS,
          this.MAX_PARENT_CHARS
        );
        for (let s = 0; s < subParents.length; s++) {
          rawParents.push({
            id: `kchk_parent_${documentId}_${parentIndex}`,
            index: parentIndex++,
            heading: `${section.heading} (Part ${s + 1})`,
            content: subParents[s].trim(),
          });
        }
      }
    }

    // 3. For each Parent Chunk, generate Child Chunks
    const parentChunks: KnowledgeChunk[] = [];
    const childChunks: KnowledgeChunk[] = [];
    let childIndex = 0;

    for (const p of rawParents) {
      const childIdsForThisParent: string[] = [];

      // Extract child chunks from parent text
      const rawChildren = this.extractChildChunks(p.content, p.heading);

      for (const childText of rawChildren) {
        const childId = `kchk_child_${documentId}_${childIndex}`;
        childIdsForThisParent.push(childId);

        // Pre-tokenize for BM25 lexical index
        const bm25Tokens = BM25Service.tokenize(childText);

        const childChunk: KnowledgeChunk = {
          id: childId,
          tenant_id: tenantId,
          document_id: documentId,
          chunk_index: childIndex++,
          chunk_type: "CHILD",
          parent_chunk_id: p.id,
          section_heading: p.heading,
          content: childText,
          embedding: [], // Embeddings attached by caller batch
          bm25_tokens: bm25Tokens,
          token_count: Math.ceil(childText.length / 4),
          metadata: {
            document_title: metadata.document_title,
            document_type: metadata.document_type,
            version: metadata.version,
            language: lang,
            parent_heading: p.heading,
          },
          created_at: now,
        };

        childChunks.push(childChunk);
      }

      // Build Parent KnowledgeChunk
      const parentChunk: KnowledgeChunk = {
        id: p.id,
        tenant_id: tenantId,
        document_id: documentId,
        chunk_index: p.index,
        chunk_type: "PARENT",
        child_chunk_ids: childIdsForThisParent,
        section_heading: p.heading,
        content: p.content,
        embedding: [], // Parents don't strictly require dense vectors; children are indexed
        bm25_tokens: BM25Service.tokenize(p.content),
        token_count: Math.ceil(p.content.length / 4),
        metadata: {
          document_title: metadata.document_title,
          document_type: metadata.document_type,
          version: metadata.version,
          language: lang,
          parent_heading: p.heading,
        },
        created_at: now,
      };

      parentChunks.push(parentChunk);
    }

    return {
      parentChunks,
      childChunks,
      totalParentCount: parentChunks.length,
      totalChildCount: childChunks.length,
    };
  }

  /**
   * Splits markdown document into structural sections by headings, preserving tables.
   */
  private static splitIntoSections(
    rawContent: string,
    defaultHeading: string
  ): Array<{ heading: string; content: string }> {
    const lines = rawContent.split("\n");
    const sections: Array<{ heading: string; content: string }> = [];

    let currentHeading = defaultHeading;
    let currentLines: string[] = [];
    let inTable = false;

    for (const line of lines) {
      const isHeader = /^#{1,4}\s+(.+)$/.test(line);
      const isTableSeparator = /^\|?[-:\s|]+\|?$/.test(line.trim());
      const isTableRow = /^\|.*\|$/.test(line.trim());

      if (isTableRow || isTableSeparator) {
        inTable = true;
      } else if (inTable && line.trim() === "") {
        inTable = false;
      }

      if (isHeader && !inTable) {
        if (currentLines.length > 0) {
          sections.push({
            heading: currentHeading,
            content: currentLines.join("\n"),
          });
          currentLines = [];
        }
        currentHeading = line.replace(/^#{1,4}\s+/, "").trim();
        currentLines.push(line);
      } else {
        currentLines.push(line);
      }
    }

    if (currentLines.length > 0) {
      sections.push({
        heading: currentHeading,
        content: currentLines.join("\n"),
      });
    }

    return sections;
  }

  /**
   * Decomposes parent content into fine-grained child chunks (150-250 tokens).
   * Intelligently preserves markdown tables and table headers.
   */
  private static extractChildChunks(content: string, heading: string): string[] {
    const lines = content.split("\n");
    const childTexts: string[] = [];

    let currentBuffer: string[] = [];
    let currentLength = 0;
    let tableHeaderLines: string[] = [];
    let inTable = false;

    for (const line of lines) {
      const isTableSep = /^\|?[-:\s|]+\|?$/.test(line.trim());
      const isTableRow = /^\|.*\|$/.test(line.trim());

      if (isTableRow || isTableSep) {
        if (!inTable) {
          inTable = true;
          tableHeaderLines = [line];
        } else if (tableHeaderLines.length === 1 && isTableSep) {
          tableHeaderLines.push(line);
        }
      } else if (inTable && line.trim() === "") {
        inTable = false;
        tableHeaderLines = [];
      }

      currentBuffer.push(line);
      currentLength += line.length + 1;

      // Check if buffer exceeded child chunk threshold
      if (currentLength >= this.TARGET_CHILD_CHARS) {
        const chunkStr = currentBuffer.join("\n").trim();
        if (chunkStr) {
          childTexts.push(chunkStr);
        }

        // Apply overlap
        if (inTable && tableHeaderLines.length > 0) {
          // If in table, prepend table header to maintain column context
          currentBuffer = [...tableHeaderLines];
          currentLength = tableHeaderLines.join("\n").length;
        } else {
          // Keep the last 2 lines for smooth narrative overlap
          const overlapLines = currentBuffer.slice(-2);
          currentBuffer = overlapLines;
          currentLength = overlapLines.join("\n").length;
        }
      }
    }

    if (currentBuffer.length > 0) {
      const remainingStr = currentBuffer.join("\n").trim();
      if (remainingStr && (!childTexts.length || remainingStr !== childTexts[childTexts.length - 1])) {
        childTexts.push(remainingStr);
      }
    }

    // Fallback if content was too short to trigger buffer flush
    if (childTexts.length === 0 && content.trim().length > 0) {
      childTexts.push(content.trim());
    }

    return childTexts;
  }

  /**
   * Helper to split large text sections by paragraph boundaries.
   */
  private static splitTextByParagraphs(
    text: string,
    targetChars: number,
    maxChars: number
  ): string[] {
    const paragraphs = text.split(/\n\n+/);
    const results: string[] = [];
    let current = "";

    for (const p of paragraphs) {
      if ((current + "\n\n" + p).length > targetChars && current.length > 0) {
        results.push(current.trim());
        current = p;
      } else {
        current = current.length > 0 ? current + "\n\n" + p : p;
      }

      if (current.length >= maxChars) {
        results.push(current.trim());
        current = "";
      }
    }

    if (current.trim().length > 0) {
      results.push(current.trim());
    }

    return results;
  }
}
