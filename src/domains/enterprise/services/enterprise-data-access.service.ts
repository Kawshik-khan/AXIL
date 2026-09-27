/**
 * CommerceOS Phase 9: Enterprise Data Access Layer
 * Resolves authorized entity scopes, enforces multi-store/brand filtering,
 * and prevents cross-entity unauthorized data leakage.
 */

import { db } from "@/infrastructure/db";
import {
  EnterpriseScope,
  EnterpriseStore,
  EnterpriseBrand,
  BusinessUnit,
  EnterpriseUserRecord,
} from "@/types/enterprise";

export class EnterpriseDataAccessService {
  /**
   * Resolves the list of stores that a user is authorized to read/manage
   */
  public getAuthorizedStores(user: EnterpriseUserRecord): EnterpriseStore[] {
    const allStores = db.getEnterpriseStores(user.organization_id);

    if (user.assigned_scope.all_access) {
      return allStores;
    }

    return allStores.filter((store) => {
      // Direct store assignment
      if (user.assigned_scope.store_ids?.includes(store.id)) {
        return true;
      }
      // Inherited from brand assignment
      if (user.assigned_scope.brand_ids?.includes(store.brand_id)) {
        return true;
      }
      // Inherited from business unit assignment
      if (user.assigned_scope.business_unit_ids?.includes(store.business_unit_id)) {
        return true;
      }
      return false;
    });
  }

  /**
   * Resolves the list of brands that a user is authorized to access
   */
  public getAuthorizedBrands(user: EnterpriseUserRecord): EnterpriseBrand[] {
    const allBrands = db.getEnterpriseBrands(user.organization_id);

    if (user.assigned_scope.all_access) {
      return allBrands;
    }

    return allBrands.filter((brand) => {
      if (user.assigned_scope.brand_ids?.includes(brand.id)) {
        return true;
      }
      if (user.assigned_scope.business_unit_ids?.includes(brand.business_unit_id)) {
        return true;
      }
      return false;
    });
  }

  /**
   * Validates if a requested entity is within the caller's authorized scope
   */
  public isEntityAuthorized(
    user: EnterpriseUserRecord,
    entityType: "STORE" | "BRAND" | "BUSINESS_UNIT",
    entityId: string
  ): boolean {
    if (user.assigned_scope.all_access) return true;

    if (entityType === "STORE") {
      const allowedStores = this.getAuthorizedStores(user);
      return allowedStores.some((s) => s.id === entityId);
    } else if (entityType === "BRAND") {
      const allowedBrands = this.getAuthorizedBrands(user);
      return allowedBrands.some((b) => b.id === entityId);
    } else if (entityType === "BUSINESS_UNIT") {
      return user.assigned_scope.business_unit_ids?.includes(entityId) || false;
    }
    return false;
  }

  public canAccessStore(user: EnterpriseUserRecord, storeId: string): boolean {
    return this.isEntityAuthorized(user, "STORE", storeId);
  }
}

export const enterpriseDataAccessService = new EnterpriseDataAccessService();
