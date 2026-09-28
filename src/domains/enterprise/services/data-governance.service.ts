/**
 * CommerceOS Phase 9: Enterprise Data Governance Service
 * Data classification (PUBLIC, INTERNAL, CONFIDENTIAL, RESTRICTED), PII masking, and retention policy management.
 */

import { db } from "@/infrastructure/db";
import { DataAsset, DataClassification } from "@/types/enterprise";

export class DataGovernanceService {
  /**
   * Registers a governed enterprise data asset
   */
  public registerAsset(
    orgId: string,
    params: {
      name: string;
      domain: string;
      classification: DataClassification;
      piiContained: boolean;
      piiFields?: string[];
      retentionDays?: number;
      ownerTeam: string;
    }
  ): DataAsset {
    const asset: DataAsset = {
      id: `asset_${params.domain.toLowerCase()}_${Date.now()}`,
      organization_id: orgId,
      name: params.name,
      domain: params.domain,
      classification: params.classification,
      pii_contained: params.piiContained,
      pii_fields: params.piiFields || [],
      retention_days: params.retentionDays || 365,
      owner_team: params.ownerTeam,
      created_at: new Date().toISOString(),
    };

    return db.createDataAsset(asset);
  }

  /**
   * Masks sensitive PII in customer payloads based on user clearance level
   */
  public maskPII(
    payload: Record<string, unknown>,
    userClearance: "RESTRICTED_ACCESS" | "STANDARD_ACCESS"
  ): Record<string, unknown> {
    if (userClearance === "RESTRICTED_ACCESS") {
      return { ...payload }; // Full unmasked access
    }

    const masked = { ...payload };

    if (typeof masked.phone === "string") {
      // E.g. "+8801711***789"
      const p = masked.phone as string;
      masked.phone = p.length > 6 ? `${p.substring(0, 6)}****${p.substring(p.length - 3)}` : "**********";
    }

    if (typeof masked.email === "string") {
      // E.g. "a***d@commerceos.io"
      const parts = (masked.email as string).split("@");
      if (parts.length === 2) {
        const u = parts[0];
        masked.email = `${u.charAt(0)}***${u.charAt(u.length - 1)}@${parts[1]}`;
      }
    }

    return masked;
  }

  /**
   * Seeds default governed data assets for an organization if none exist
   */
  /**
   * The organization's data assets: stored ones, or the default catalogue built in memory when none are stored yet.
   * Read-only (FX-21).
   */
  public listAssets(orgId: string): DataAsset[] {
    const stored = db.getDataAssets(orgId);
    if (stored.length > 0) return stored;
    // Organizations created before FX-21 have nothing stored: show the defaults, stamped with the org's own date.
    const now = db.findOrganizationById(orgId)?.created_at ?? "1970-01-01T00:00:00.000Z";
    return this.defaultAssetParams().map((a) => ({
      id: `asset_${a.domain.toLowerCase()}_default_${orgId}`,
      organization_id: orgId,
      name: a.name,
      domain: a.domain,
      classification: a.classification,
      pii_contained: a.piiContained,
      pii_fields: a.piiFields || [],
      retention_days: a.retentionDays || 365,
      owner_team: a.ownerTeam,
      created_at: now,
    }));
  }

  public seedDefaultAssets(orgId: string): DataAsset[] {
    return this.defaultAssetParams().map((asset) => this.registerAsset(orgId, asset));
  }

  private defaultAssetParams(): Array<Parameters<DataGovernanceService["registerAsset"]>[1]> {
    const defaultAssets: Array<Parameters<DataGovernanceService["registerAsset"]>[1]> = [
      {
        name: "Enterprise Customer Directory",
        domain: "CUSTOMERS",
        classification: "RESTRICTED",
        piiContained: true,
        piiFields: ["name", "phone", "email", "shipping_address"],
        retentionDays: 730,
        ownerTeam: "Enterprise Security & Compliance",
      },
      {
        name: "Unified Transaction Orders",
        domain: "ORDERS",
        classification: "CONFIDENTIAL",
        piiContained: true,
        piiFields: ["customer_phone", "shipping_address"],
        retentionDays: 1825,
        ownerTeam: "Commerce Core & Finance",
      },
      {
        name: "Global Warehouse Inventory Catalog",
        domain: "INVENTORY",
        classification: "INTERNAL",
        piiContained: false,
        retentionDays: 365,
        ownerTeam: "Supply Chain & Logistics",
      },
      {
        name: "Consolidated Financial Ledger",
        domain: "FINANCE",
        classification: "RESTRICTED",
        piiContained: false,
        retentionDays: 2555,
        ownerTeam: "Enterprise Treasury",
      },
    ];
    return defaultAssets;
  }
}

export const dataGovernanceService = new DataGovernanceService();
