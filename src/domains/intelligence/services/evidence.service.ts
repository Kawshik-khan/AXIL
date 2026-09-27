/**
 * CommerceOS Phase 6: Evidence & Explainability Service
 * Builds immutable, auditable factual citations linking insights and recommendations to ground-truth sources.
 */

import { EvidenceItem } from "@/types/intelligence";

export class EvidenceService {
  /**
   * Constructs a structured factual evidence item
   */
  public createEvidence(params: {
    sourceType: EvidenceItem["source_type"];
    sourceId: string;
    metric: string;
    value: number | string;
    description: string;
    confidence?: number;
    period?: string;
    comparison?: string;
  }): EvidenceItem {
    return {
      id: `ev_${Math.random().toString(36).substring(2, 9)}`,
      source_type: params.sourceType,
      source_id: params.sourceId,
      metric: params.metric,
      value: params.value,
      timestamp: new Date().toISOString(),
      period: params.period,
      comparison: params.comparison,
      confidence: params.confidence !== undefined ? params.confidence : 0.95,
      query_version: "1.0.0",
      description: params.description,
    };
  }
}

export const evidenceService = new EvidenceService();
