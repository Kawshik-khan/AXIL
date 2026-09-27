import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 9: Master Data Management (MDM) Service
 * Manages canonical master records, cross-system external ID maps, duplicate detection, and merge governance.
 */

import { db } from "@/infrastructure/db";

export interface MasterRecordMapping {
  domain: "PRODUCT" | "CUSTOMER" | "SUPPLIER" | "STORE";
  canonical_id: string;
  external_system: string;
  external_id: string;
  verified_at: string;
}

export interface MergeProposal {
  id: string;
  organization_id: string;
  domain: string;
  source_record_id: string;
  target_record_id: string;
  confidence_score: number;
  match_reasons: string[];
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  created_at: string;
}

export class MasterDataService {
  private mappings: MasterRecordMapping[] = [];
  private proposals: MergeProposal[] = [];

  /**
   * Links a canonical CommerceOS entity ID with an external system record ID
   */
  public linkExternalId(params: {
    domain: "PRODUCT" | "CUSTOMER" | "SUPPLIER" | "STORE";
    canonicalId: string;
    externalSystem: string;
    externalId: string;
  }): MasterRecordMapping {
    const existing = this.mappings.find(
      (m) =>
        m.domain === params.domain &&
        m.external_system === params.externalSystem &&
        m.external_id === params.externalId
    );
    if (existing) {
      existing.canonical_id = params.canonicalId;
      existing.verified_at = new Date().toISOString();
      return existing;
    }

    const mapping: MasterRecordMapping = {
      domain: params.domain,
      canonical_id: params.canonicalId,
      external_system: params.externalSystem,
      external_id: params.externalId,
      verified_at: new Date().toISOString(),
    };
    this.mappings.push(mapping);
    return mapping;
  }

  /**
   * Proposes a merge between two probable duplicate master records
   */
  public proposeMerge(
    orgId: string,
    params: {
      domain: string;
      sourceId: string;
      targetId: string;
      confidence: number;
      reasons: string[];
    }
  ): MergeProposal {
    const proposal: MergeProposal = {
      id: `mrg_${Date.now()}_${randomSuffix()}`,
      organization_id: orgId,
      domain: params.domain,
      source_record_id: params.sourceId,
      target_record_id: params.targetId,
      confidence_score: params.confidence,
      match_reasons: params.reasons,
      status: "PENDING_APPROVAL",
      created_at: new Date().toISOString(),
    };

    this.proposals.push(proposal);
    return proposal;
  }

  public getPendingProposals(orgId: string): MergeProposal[] {
    return this.proposals.filter((p) => p.organization_id === orgId && p.status === "PENDING_APPROVAL");
  }
}

export const masterDataService = new MasterDataService();
