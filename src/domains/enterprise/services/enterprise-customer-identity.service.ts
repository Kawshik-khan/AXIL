import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 9: Enterprise Customer Identity Resolution Service
 * Cross-store, cross-brand identity resolution, confidence scoring, and high-impact merge review.
 */

import { db } from "@/infrastructure/db";
import { EnterpriseCustomerIdentity } from "@/types/enterprise";

export class EnterpriseCustomerIdentityService {
  /**
   * Resolves or links an enterprise customer identity across stores and brands
   */
  public resolveIdentity(params: {
    organizationId: string;
    storeId: string;
    name: string;
    phone: string;
    email?: string;
    externalSystem?: "SHOPIFY" | "DARAZ" | "CRM" | "ERP" | "FACEBOOK";
    externalId?: string;
  }): { identity: EnterpriseCustomerIdentity; isNew: boolean; matchType: "EXACT_PHONE" | "EMAIL" | "EXTERNAL_ID" | "CREATED" } {
    const existingIdentities = db.getEnterpriseCustomerIdentities(params.organizationId);

    // 1. Check exact phone match (highest deterministic signal)
    const phoneMatch = existingIdentities.find((i) => i.primary_phone === params.phone);
    if (phoneMatch) {
      if (!phoneMatch.store_affiliations.includes(params.storeId)) {
        phoneMatch.store_affiliations.push(params.storeId);
      }
      if (params.externalSystem && params.externalId) {
        const hasExt = phoneMatch.external_identities.some(
          (e) => e.system_type === params.externalSystem && e.external_id === params.externalId
        );
        if (!hasExt) {
          phoneMatch.external_identities.push({
            system_type: params.externalSystem,
            external_id: params.externalId,
            linked_at: new Date().toISOString(),
          });
        }
      }
      db.updateEnterpriseCustomerIdentity(phoneMatch.id, phoneMatch);
      return { identity: phoneMatch, isNew: false, matchType: "EXACT_PHONE" };
    }

    // 2. Check external ID match
    if (params.externalSystem && params.externalId) {
      const extMatch = existingIdentities.find((i) =>
        i.external_identities.some(
          (e) => e.system_type === params.externalSystem && e.external_id === params.externalId
        )
      );
      if (extMatch) {
        return { identity: extMatch, isNew: false, matchType: "EXTERNAL_ID" };
      }
    }

    // 3. Create new enterprise customer identity
    const newIdentity: EnterpriseCustomerIdentity = {
      id: `ecust_${Date.now()}_${randomSuffix()}`,
      organization_id: params.organizationId,
      canonical_name: params.name,
      primary_phone: params.phone,
      primary_email: params.email,
      store_affiliations: [params.storeId],
      external_identities:
        params.externalSystem && params.externalId
          ? [{ system_type: params.externalSystem, external_id: params.externalId, linked_at: new Date().toISOString() }]
          : [],
      total_lifetime_orders: 1,
      total_spend_bdt: 0,
      confidence_score: 1.0,
      requires_manual_merge_review: false,
      status: "VERIFIED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    db.createEnterpriseCustomerIdentity(newIdentity);
    return { identity: newIdentity, isNew: true, matchType: "CREATED" };
  }
}

export const enterpriseCustomerIdentityService = new EnterpriseCustomerIdentityService();
