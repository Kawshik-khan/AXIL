import { AppError, IntegrationNotConfiguredError } from "@/lib/errors";
import { encryptCredential } from "@/lib/security";
/**
 * CommerceOS Phase 9: Enterprise Integration Hub Service
 * Manages external integrations (ERP, CRM, Accounting, Marketplaces), installation lifecycles, and health telemetry.
 */

import { db } from "@/infrastructure/db";
import {
  IntegrationProvider,
  IntegrationInstallation,
  IntegrationStatus,
} from "@/types/enterprise";
import { randomSuffix } from "@/lib/ids";

/** An installation without its stored credentials, for API responses. */
export type PublicIntegrationInstallation = Omit<IntegrationInstallation, "credentials_encrypted">;

export function toPublicInstallation(inst: IntegrationInstallation): PublicIntegrationInstallation {
  const { credentials_encrypted: _omit, ...rest } = inst;
  return rest;
}

export class IntegrationHubService {
  /**
   * The integration catalog: stored providers plus the built-in defaults not stored yet. Read-only (FX-21).
   */
  public listProviders(): IntegrationProvider[] {
    const stored = db.getIntegrationProviders();
    const storedIds = new Set(stored.map((p) => p.id));
    return [...stored, ...this.defaultProviders().filter((p) => !storedIds.has(p.id))];
  }

  /**
   * Stores the built-in integration catalog (called by the install path, not by reads).
   */
  public seedDefaultProviders(): IntegrationProvider[] {
    const defaultProviders = this.defaultProviders();
    let added = false;
    for (const p of defaultProviders) {
      const existing = db.getIntegrationProviders().find((item) => item.id === p.id);
      if (!existing) {
        db.data.integration_providers.push(p);
        added = true;
      }
    }
    if (added) db.markDirty(); // persists direct changes to db.data (FX-20)
    return db.getIntegrationProviders();
  }

  private defaultProviders(): IntegrationProvider[] {
    return [
      {
        id: "prov_sap_s4hana",
        name: "SAP S/4HANA",
        category: "ERP",
        supported_entities: ["PRODUCT", "INVENTORY", "ORDER", "PURCHASE_ORDER", "INVOICE"],
        auth_type: "OAUTH2",
        description: "Enterprise ERP sync for master inventory, procurement, and financial ledgers.",
      },
      {
        id: "prov_oracle_netsuite",
        name: "Oracle NetSuite",
        category: "ERP",
        supported_entities: ["PRODUCT", "INVENTORY", "ORDER", "INVOICE"],
        auth_type: "OAUTH2",
        description: "Cloud ERP bidirectional orders, billing, and supply chain reconciliation.",
      },
      {
        id: "prov_salesforce_crm",
        name: "Salesforce CRM",
        category: "CRM",
        supported_entities: ["CUSTOMER", "DEAL", "ACTIVITY"],
        auth_type: "OAUTH2",
        description: "Customer lifecycle, high-value B2B lead synchronization, and contact identities.",
      },
      {
        id: "prov_hubspot_crm",
        name: "HubSpot",
        category: "CRM",
        supported_entities: ["CUSTOMER", "ACTIVITY", "DEAL"],
        auth_type: "API_KEY",
        description: "Inbound marketing contact properties, segmented list memberships, and deal stages.",
      },
      {
        id: "prov_daraz_marketplace",
        name: "Daraz Marketplace",
        category: "MARKETPLACE",
        supported_entities: ["PRODUCT", "INVENTORY", "ORDER", "SHIPMENT"],
        auth_type: "API_KEY",
        description: "Bangladesh leading marketplace order ingestion and catalog inventory synchronization.",
      },
      {
        id: "prov_shopify_plus",
        name: "Shopify Plus",
        category: "MARKETPLACE",
        supported_entities: ["PRODUCT", "INVENTORY", "ORDER", "CUSTOMER"],
        auth_type: "OAUTH2",
        description: "Multi-store web storefront catalog and order webhook pipeline.",
      },
    ];
  }

  /**
   * Installs and configures an integration for an organization
   */
  public installIntegration(
    orgId: string,
    params: {
      providerId: string;
      credentials: Record<string, string>;
      config?: Record<string, unknown>;
      syncFrequencyMinutes?: number;
    }
  ): IntegrationInstallation {
    this.seedDefaultProviders();
    const provider = db.getIntegrationProviders().find((p) => p.id === params.providerId);
    if (!provider) throw new AppError("NOT_FOUND", `Integration provider not found: ${params.providerId}`, 404);

    const installation: IntegrationInstallation = {
      id: `inst_${params.providerId.replace("prov_", "")}_${Date.now()}_${randomSuffix()}`,
      organization_id: orgId,
      provider_id: provider.id,
      provider_name: provider.name,
      category: provider.category,
      // Saved, never checked with the provider: this was HEALTHY with invented sync times, and the credentials were only
      // base64-encoded and returned by the list endpoint (FX-31).
      status: "NOT_VERIFIED",
      credentials_encrypted: encryptCredential(params.credentials),
      config: params.config || {},
      sync_frequency_minutes: params.syncFrequencyMinutes || 60,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return db.createIntegrationInstallation(installation);
  }

  /**
   * "Tests" an integration. No provider adapter exists yet, so nothing is contacted: the result says SIMULATED instead of
   * claiming verified credentials (non-negotiable 7). Scoped to the caller's organization (FX-13, security review).
   */
  public testConnection(
    orgId: string,
    installationId: string
  ): { success: boolean; status: "SIMULATED" | "DISCONNECTED"; latency_ms: null; message: string } {
    const inst = db.data.integration_installations.find((i) => i.id === installationId && i.organization_id === orgId);
    if (!inst) throw new AppError("NOT_FOUND", `Integration installation not found: ${installationId}`, 404);

    if (inst.status === "DISCONNECTED") {
      return { success: false, status: "DISCONNECTED", latency_ms: null, message: "Integration is disconnected." };
    }

    return {
      success: false,
      status: "SIMULATED",
      latency_ms: null,
      message: `No live connection test exists for ${inst.provider_name} yet; nothing was contacted and the credentials were not checked.`,
    };
  }

  /**
   * A provider sync. No provider adapter can fetch from ERP/CRM/marketplace systems yet, so this refuses instead of
   * recording a COMPLETED sync of a placeholder item and marking the installation HEALTHY (FX-31).
   */
  public triggerProviderSync(orgId: string, installationId: string): never {
    const inst = db.data.integration_installations.find((i) => i.id === installationId && i.organization_id === orgId);
    if (!inst) throw new AppError("NOT_FOUND", `Integration installation not found: ${installationId}`, 404);
    throw new IntegrationNotConfiguredError(`${inst.provider_name} sync`, "no provider adapter exists yet");
  }

  /**
   * Updates integration status (e.g. on error, circuit breaker, or recovery)
   */
  public updateStatus(orgId: string, installationId: string, status: IntegrationStatus, errorSummary?: string): IntegrationInstallation {
    return db.updateIntegrationInstallation(orgId, installationId, {
      status,
      last_error: errorSummary,
      updated_at: new Date().toISOString(),
    });
  }
}

export const integrationHubService = new IntegrationHubService();
