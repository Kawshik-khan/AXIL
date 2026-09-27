/**
 * CommerceOS: BM25 Lexical Retrieval Engine
 *
 * Implements the BM25 Okapi ranking algorithm optimized for Bangladeshi E-Commerce:
 * - Multilingual tokenization (Bengali Unicode, Banglish transliteration, English)
 * - Exact product SKU matching (e.g. "TSHIRT-BLK-XL", "POLO-001")
 * - Numerical fee extraction (e.g. "60 tk", "120 BDT", "7 days")
 * - Tenant-isolated lexical indexing & scoring
 */

import { KnowledgeChunk, BM25SearchResult } from "@/types/ai";

export class BM25Service {
  // BM25 Okapi hyper-parameters
  private static readonly K1 = 1.2;
  private static readonly B = 0.75;

  // Basic stopwords for Bengali and English
  private static readonly STOP_WORDS = new Set([
    // English
    "a", "an", "the", "and", "or", "but", "if", "then", "of", "at", "by",
    "for", "with", "about", "against", "between", "into", "through",
    "during", "before", "after", "above", "below", "to", "from", "up",
    "down", "in", "out", "on", "off", "over", "under", "again", "further",
    "then", "once", "here", "there", "when", "where", "why", "how", "all",
    "any", "both", "each", "few", "more", "most", "other", "some", "such",
    "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very",
    "can", "will", "just", "don", "should", "now", "is", "are", "was", "were",
    // Bengali & Banglish conversational filler words
    "এই", "সেই", "কি", "কী", "বা", "এবং", "ও", "না", "হলে", "থেকে", "দিয়ে",
    "করে", "করুন", "হবে", "আছে", "ছিল", "এর", "তে", "কে", "যে", "কোন", "একটি",
    "vai", "bhai", "apa", "sir", "koto", "koto?", "hobe", "parbo", "bolen", "den", "amader", "apnar"
  ]);

  /**
   * Tokenizes text into normalized lexical units.
   * Preserves alphanumeric SKUs, Bengali characters, and numbers.
   */
  public static tokenize(text: string): string[] {
    if (!text || typeof text !== "string") return [];

    // Replace markdown formatting symbols with whitespace
    const cleanText = text
      .replace(/[#*_`|~[\](){}<>\\/]/g, " ")
      .replace(/https?:\/\/\S+/g, " ")
      .toLowerCase();

    // Regex matching:
    // 1. Alphanumeric SKUs / hyphenated codes: [a-z0-9]+(-[a-z0-9]+)+
    // 2. Bengali script: [\u0980-\u09FF]+
    // 3. English words & numbers: [a-z0-9]+
    const tokenRegex = /[a-z0-9]+(?:-[a-z0-9]+)+|[\u0980-\u09ff]+|[a-z0-9]+/gi;
    const matches = cleanText.match(tokenRegex);

    if (!matches) return [];

    const tokens: string[] = [];
    for (const rawToken of matches) {
      const t = rawToken.trim();
      // Filter single-letter non-digits unless SKU indicator
      if (t.length > 1 || /\d/.test(t)) {
        if (!this.STOP_WORDS.has(t)) {
          tokens.push(t);
        }
      }
    }

    return tokens;
  }

  /**
   * Performs BM25 scoring over a collection of KnowledgeChunks for a query.
   * Strictly respects tenant isolation.
   */
  public static search(
    tenantId: string,
    query: string,
    chunks: KnowledgeChunk[],
    topK: number = 20
  ): BM25SearchResult[] {
    // Strictly isolate by tenant
    const tenantChunks = chunks.filter((c) => c.tenant_id === tenantId);
    if (tenantChunks.length === 0) return [];

    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) return [];

    const N = tenantChunks.length;

    // 1. Pre-compute or get document tokens and document lengths
    const docTokensMap = new Map<string, string[]>();
    let totalDocLen = 0;

    for (const chunk of tenantChunks) {
      const tokens = chunk.bm25_tokens && chunk.bm25_tokens.length > 0
        ? chunk.bm25_tokens
        : this.tokenize(chunk.content);
      docTokensMap.set(chunk.id, tokens);
      totalDocLen += tokens.length;
    }

    const avgdl = totalDocLen > 0 ? totalDocLen / N : 1;

    // 2. Calculate Document Frequency (DF) for each query token
    const docFrequency = new Map<string, number>();
    for (const qToken of queryTokens) {
      let count = 0;
      for (const chunk of tenantChunks) {
        const tokens = docTokensMap.get(chunk.id)!;
        if (tokens.includes(qToken)) {
          count++;
        }
      }
      docFrequency.set(qToken, count);
    }

    // 3. Compute BM25 Score for each chunk
    const scoredChunks: Array<{ chunk: KnowledgeChunk; score: number }> = [];

    for (const chunk of tenantChunks) {
      const tokens = docTokensMap.get(chunk.id)!;
      const docLen = tokens.length;

      // Count term frequencies in this document
      const termFreq = new Map<string, number>();
      for (const t of tokens) {
        termFreq.set(t, (termFreq.get(t) || 0) + 1);
      }

      let score = 0;
      for (const qToken of queryTokens) {
        const tf = termFreq.get(qToken) || 0;
        if (tf === 0) continue;

        const df = docFrequency.get(qToken) || 0;
        // Robertson-Spärck Jones IDF formula with floor at 0
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));

        // Term frequency saturation with length normalization
        const numerator = tf * (this.K1 + 1);
        const denominator = tf + this.K1 * (1 - this.B + this.B * (docLen / avgdl));

        // Bonus multiplier for exact SKU or code match in section heading
        let headingBonus = 1.0;
        if (chunk.section_heading && chunk.section_heading.toLowerCase().includes(qToken)) {
          headingBonus = 1.35;
        }

        score += idf * (numerator / denominator) * headingBonus;
      }

      if (score > 0) {
        scoredChunks.push({ chunk, score });
      }
    }

    // 4. Sort descending and attach ranks
    scoredChunks.sort((a, b) => b.score - a.score);
    const topResults = scoredChunks.slice(0, topK);

    return topResults.map((item, index) => ({
      chunk: item.chunk,
      score: Number(item.score.toFixed(4)),
      rank: index + 1,
    }));
  }
}
