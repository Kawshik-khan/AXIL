/**
 * CommerceOS Phase 10: Data Residency Service
 * Data residency policies, transfer compliance, and region-aware routing (§31–§36).
 */

import { db } from "@/infrastructure/db";
import { DataResidencyPolicy, DataRegionCode } from "@/types/autonomous";

export class DataResidencyService {
  getPolicies(tenantId: string): DataResidencyPolicy[] {
    return db.data.data_residency_policies.filter((p) => p.tenant_id === tenantId);
  }

  createPolicy(policy: DataResidencyPolicy): DataResidencyPolicy {
    policy.created_at = new Date().toISOString();
    policy.updated_at = policy.created_at;
    db.data.data_residency_policies.push(policy);
    return policy;
  }

  /** Check if a data transfer between regions is compliant. */
  isTransferCompliant(tenantId: string, sourceRegion: DataRegionCode, targetRegion: DataRegionCode, dataClassification: string): {
    compliant: boolean;
    violations: string[];
  } {
    const policies = this.getPolicies(tenantId).filter((p) => p.enabled);
    const violations: string[] = [];

    for (const policy of policies) {
      if (policy.data_classification === dataClassification) {
        if (policy.storage_requirement === "LOCAL_ONLY" && sourceRegion !== targetRegion) {
          violations.push(`${policy.name}: LOCAL_ONLY storage prohibits transfer from ${sourceRegion} to ${targetRegion}`);
        }
        if (!policy.allowed_transfer_regions.includes(targetRegion)) {
          violations.push(`${policy.name}: ${targetRegion} not in allowed transfer regions`);
        }
      }
    }

    return { compliant: violations.length === 0, violations };
  }

  /** Get the required region for a data classification. */
  getRequiredRegion(tenantId: string, dataClassification: string): DataRegionCode {
    const policy = this.getPolicies(tenantId).find(
      (p) => p.enabled && p.data_classification === dataClassification
    );
    return policy?.region || "BD";
  }
}
