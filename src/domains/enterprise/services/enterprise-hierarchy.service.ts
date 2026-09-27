/**
 * CommerceOS Phase 9: Enterprise Hierarchy & Multi-Entity Management Service
 * Manages configurable multi-tier hierarchy: Organization -> Business Units -> Brand Groups -> Brands -> Stores -> Channels
 */

import { db } from "@/infrastructure/db";
import {
  Organization,
  BusinessUnit,
  BrandGroup,
  EnterpriseBrand,
  EnterpriseStore,
  SalesChannel,
  Region,
  EntityMembership,
  EntityType,
} from "@/types/enterprise";

export interface HierarchyTree {
  organization: Organization;
  business_units: Array<{
    unit: BusinessUnit;
    brand_groups: Array<{
      group: BrandGroup;
      brands: Array<{
        brand: EnterpriseBrand;
        stores: EnterpriseStore[];
      }>;
    }>;
    standalone_brands: Array<{
      brand: EnterpriseBrand;
      stores: EnterpriseStore[];
    }>;
  }>;
}

export class EnterpriseHierarchyService {
  /**
   * Initializes or updates an Organization entity
   */
  public createOrganization(params: {
    id?: string;
    name: string;
    slug: string;
    legal_name: string;
    tax_identifier?: string;
    default_currency?: string;
    supported_currencies?: string[];
    headquarters_country?: string;
  }): Organization {
    const org: Organization = {
      id: params.id || `org_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: params.name,
      slug: params.slug,
      legal_name: params.legal_name,
      tax_identifier: params.tax_identifier,
      default_currency: params.default_currency || "BDT",
      supported_currencies: params.supported_currencies || ["BDT", "USD"],
      headquarters_country: params.headquarters_country || "Bangladesh",
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return db.createOrganization(org);
  }

  public getOrganization(orgId: string): Organization | undefined {
    return db.findOrganizationById(orgId);
  }

  /**
   * Creates a Business Unit within an Organization
   */
  public createBusinessUnit(orgId: string, params: {
    id?: string;
    name: string;
    code: string;
    description?: string;
    budget_allocated_bdt?: number;
  }): BusinessUnit {
    const bu: BusinessUnit = {
      id: params.id || `bu_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      organization_id: orgId,
      name: params.name,
      code: params.code.toUpperCase(),
      description: params.description,
      budget_allocated_bdt: params.budget_allocated_bdt || 0,
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return db.createBusinessUnit(bu);
  }

  /**
   * Creates an Enterprise Brand under an Organization and Business Unit
   */
  public createBrand(orgId: string, params: {
    id?: string;
    business_unit_id: string;
    name: string;
    slug: string;
    primary_category: string;
    target_audience?: string;
    currency?: string;
    shared_resources?: {
      warehouses: boolean;
      payment_gateways: boolean;
      couriers: boolean;
    };
  }): EnterpriseBrand {
    const brand: EnterpriseBrand = {
      id: params.id || `br_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      organization_id: orgId,
      business_unit_id: params.business_unit_id,
      name: params.name,
      slug: params.slug,
      primary_category: params.primary_category,
      target_audience: params.target_audience,
      currency: params.currency || "BDT",
      shared_resources: params.shared_resources || {
        warehouses: true,
        payment_gateways: true,
        couriers: true,
      },
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return db.createEnterpriseBrand(brand);
  }

  /**
   * Creates an Enterprise Store under a Brand
   */
  public createStore(orgId: string, params: {
    id?: string;
    business_unit_id: string;
    brand_id: string;
    name: string;
    code: string;
    store_type?: "ONLINE_STORE" | "PHYSICAL_OUTLET" | "POPUP" | "MARKETPLACE_OUTLET";
    region?: string;
    city?: string;
    currency?: string;
    assigned_warehouse_ids?: string[];
    assigned_payment_provider_ids?: string[];
    assigned_courier_ids?: string[];
  }): EnterpriseStore {
    const store: EnterpriseStore = {
      id: params.id || `str_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      organization_id: orgId,
      business_unit_id: params.business_unit_id,
      brand_id: params.brand_id,
      name: params.name,
      code: params.code.toUpperCase(),
      store_type: params.store_type || "ONLINE_STORE",
      region: params.region || "Dhaka Division",
      city: params.city || "Dhaka",
      currency: params.currency || "BDT",
      assigned_warehouse_ids: params.assigned_warehouse_ids || [],
      assigned_payment_provider_ids: params.assigned_payment_provider_ids || [],
      assigned_courier_ids: params.assigned_courier_ids || [],
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return db.createEnterpriseStore(store);
  }

  /**
   * Retrieves full hierarchical view of the organization
   */
  public getHierarchyTree(orgId: string): HierarchyTree | null {
    const org = db.findOrganizationById(orgId);
    if (!org) return null;

    const bus = db.getBusinessUnits(orgId);
    const brands = db.getEnterpriseBrands(orgId);
    const stores = db.getEnterpriseStores(orgId);

    const tree: HierarchyTree = {
      organization: org,
      business_units: bus.map((bu) => {
        const buBrands = brands.filter((b) => b.business_unit_id === bu.id);
        return {
          unit: bu,
          brand_groups: [],
          standalone_brands: buBrands.map((brand) => ({
            brand,
            stores: stores.filter((s) => s.brand_id === brand.id),
          })),
        };
      }),
    };

    return tree;
  }

  public buildHierarchyTree(orgId: string): HierarchyTree | null {
    return this.getHierarchyTree(orgId);
  }

  /**
   * Assigns user membership to an enterprise entity
   */
  public assignMembership(params: {
    organization_id: string;
    user_id: string;
    entity_type: EntityType;
    entity_id: string;
    role: string;
    granted_by: string;
  }): EntityMembership {
    const membership: EntityMembership = {
      id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      organization_id: params.organization_id,
      user_id: params.user_id,
      entity_type: params.entity_type,
      entity_id: params.entity_id,
      role: params.role,
      granted_by: params.granted_by,
      created_at: new Date().toISOString(),
    };

    return db.createEntityMembership(membership);
  }
}

export const enterpriseHierarchyService = new EnterpriseHierarchyService();
