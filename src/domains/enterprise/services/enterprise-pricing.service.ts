/**
 * CommerceOS Phase 9: Enterprise Pricing Governance Service
 * Hierarchical pricing policies (Enterprise > Brand > Store) where the most restrictive margin policy wins.
 */

export interface PricingPolicyCheckResult {
  allowed: boolean;
  effectiveMinMarginPct: number;
  policySource: "ENTERPRISE_FLOOR" | "BRAND_POLICY" | "STORE_POLICY";
  proposedPrice: number;
  projectedMarginPct: number;
  rejectionReason?: string;
}

export class EnterprisePricingService {
  /**
   * Evaluates a proposed price markdown against the enterprise policy hierarchy
   */
  public evaluatePriceChange(params: {
    enterpriseMinMarginPct: number; // e.g. 20%
    brandMinMarginPct?: number; // e.g. 22%
    storeMinMarginPct?: number; // e.g. 18%
    costPrice: number; // e.g. 1000
    proposedPrice: number; // e.g. 1150
  }): PricingPolicyCheckResult {
    // Most restrictive margin floor wins
    const floors = [
      { source: "ENTERPRISE_FLOOR" as const, floor: params.enterpriseMinMarginPct },
      { source: "BRAND_POLICY" as const, floor: params.brandMinMarginPct || 0 },
      { source: "STORE_POLICY" as const, floor: params.storeMinMarginPct || 0 },
    ];

    floors.sort((a, b) => b.floor - a.floor);
    const winningPolicy = floors[0];
    const effectiveMinMargin = winningPolicy.floor;

    const projectedMarginPct = Number(
      (((params.proposedPrice - params.costPrice) / params.proposedPrice) * 100).toFixed(1)
    );

    const allowed = projectedMarginPct >= effectiveMinMargin;

    return {
      allowed,
      effectiveMinMarginPct: effectiveMinMargin,
      policySource: winningPolicy.source,
      proposedPrice: params.proposedPrice,
      projectedMarginPct,
      rejectionReason: allowed
        ? undefined
        : `Proposed price BDT ${params.proposedPrice} yields ${projectedMarginPct}% margin, violating ${winningPolicy.source} of ${effectiveMinMargin}%.`,
    };
  }
}

export const enterprisePricingService = new EnterprisePricingService();
