/**
 * CommerceOS Phase 4: Semantic Chunking Service
 * Splits markdown and policy documents by headings, preserves tables intact, and maintains overlap.
 */

export interface ChunkResult {
  chunk_index: number;
  section_heading: string;
  content: string;
  token_count: number;
}

export class ChunkingService {
  private static readonly TARGET_CHUNK_CHARS = 1200; // ~300 tokens
  private static readonly MAX_CHUNK_CHARS = 1800; // ~450 tokens
  private static readonly OVERLAP_CHARS = 150; // ~35 tokens

  /**
   * Semantically chunks raw document text while preserving tables and headings.
   */
  public static chunkDocument(rawContent: string, defaultHeading: string = "Overview"): ChunkResult[] {
    if (!rawContent || !rawContent.trim()) {
      return [];
    }

    const lines = rawContent.split("\n");
    const sections: Array<{ heading: string; lines: string[] }> = [];

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

      // If header encountered outside of an active table, split section
      if (isHeader && !inTable) {
        if (currentLines.length > 0) {
          sections.push({
            heading: currentHeading,
            lines: [...currentLines],
          });
          currentLines = [];
        }
        currentHeading = line.replace(/^#{1,4}\s+/, "").trim();
      } else {
        currentLines.push(line);
      }
    }

    if (currentLines.length > 0) {
      sections.push({
        heading: currentHeading,
        lines: currentLines,
      });
    }

    // Now convert sections to bounded chunks
    const chunks: ChunkResult[] = [];
    let chunkIndex = 0;

    for (const sec of sections) {
      const fullText = sec.lines.join("\n").trim();
      if (!fullText) continue;

      if (fullText.length <= this.MAX_CHUNK_CHARS) {
        chunks.push({
          chunk_index: chunkIndex++,
          section_heading: sec.heading,
          content: fullText,
          token_count: Math.ceil(fullText.length / 4),
        });
      } else {
        // Sub-split long section while attempting to preserve paragraphs and tables
        const paragraphs = fullText.split(/\n\n+/);
        let currentChunkText = "";

        for (const p of paragraphs) {
          if ((currentChunkText + "\n\n" + p).length > this.TARGET_CHUNK_CHARS && currentChunkText.length > 0) {
            chunks.push({
              chunk_index: chunkIndex++,
              section_heading: sec.heading,
              content: currentChunkText.trim(),
              token_count: Math.ceil(currentChunkText.length / 4),
            });
            // Overlap with end of previous chunk
            const overlap = currentChunkText.slice(-this.OVERLAP_CHARS);
            currentChunkText = overlap + "\n\n" + p;
          } else {
            currentChunkText = currentChunkText.length > 0 ? currentChunkText + "\n\n" + p : p;
          }
        }

        if (currentChunkText.trim().length > 0) {
          chunks.push({
            chunk_index: chunkIndex++,
            section_heading: sec.heading,
            content: currentChunkText.trim(),
            token_count: Math.ceil(currentChunkText.length / 4),
          });
        }
      }
    }

    return chunks;
  }
}
