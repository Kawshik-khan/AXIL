import { db } from "@/infrastructure/db";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { encryptCredential, decryptCredential, maskSecret } from "@/lib/security";
import { BadRequestError, NotFoundError } from "@/lib/errors";
import {
  ConnectorCategory,
  ConnectorProviderDefinition,
  ConnectorConfigRecord,
  SaveConnectorPayload,
  TestConnectionPayload,
  TestConnectionResult,
  SaveConnectorSchema,
  TestConnectionSchema,
} from "@/types/connector";
import { randomSuffix } from "@/lib/ids";
import { runLiveCheck } from "./live-checks";
import { PROVIDER_MANIFESTS } from "./manifests";

/**
 * Connector tests used to return success with a random latency and claims like "webhook verified with 200 OK" without
 * contacting anything (FX-31). Where no live test exists, say so.
 */
function notVerified(providerName: string, details?: Record<string, unknown>): TestConnectionResult {
  return {
    success: false,
    status: "NOT_VERIFIED",
    latency_ms: null,
    message: `Live test not implemented for ${providerName}; credentials saved but unverified.`,
    details,
  };
}

export class ConnectorService {
  /**
   * The connector catalog: the provider manifests in ./manifests
   */
  public static readonly PROVIDERS: ConnectorProviderDefinition[] = PROVIDER_MANIFESTS;

  /**
   * Smart Database URI Parser:
   * Extracts host, port, database, username, password, and ssl parameters from postgres://, mysql://, redis://
   */
  public static parseDatabaseUri(rawUri: string): {
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    password?: string;
    ssl_mode?: string;
  } {
    try {
      const parsed = new URL(rawUri);
      const protocol = parsed.protocol.replace(":", "").toLowerCase();

      let defaultPort = 5432;
      if (protocol.includes("mysql")) defaultPort = 3306;
      if (protocol.includes("redis")) defaultPort = 6379;

      const host = parsed.hostname;
      const port = parsed.port ? parseInt(parsed.port, 10) : defaultPort;
      const database = parsed.pathname ? parsed.pathname.replace(/^\//, "") : "";
      const username = decodeURIComponent(parsed.username || "");
      const password = decodeURIComponent(parsed.password || "");

      const sslParam = parsed.searchParams.get("sslmode") || parsed.searchParams.get("ssl");
      let ssl_mode = "require";
      if (sslParam === "disable" || sslParam === "false") {
        ssl_mode = "disable";
      }

      return {
        host,
        port,
        database: database || undefined,
        username: username || undefined,
        password: password || undefined,
        ssl_mode,
      };
    } catch {
      return {};
    }
  }

  /**
   * List all connectors with their configuration status and masked credentials
   */
  public static async listConnectors(
    context: RequestContext,
    category?: ConnectorCategory
  ): Promise<{
    providers: ConnectorProviderDefinition[];
    configurations: Array<Omit<ConnectorConfigRecord, "credentials_encrypted">>;
    stats: {
      total_available: number;
      total_active: number;
      by_category: Record<ConnectorCategory, { available: number; active: number }>;
    };
  }> {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_READ);

    const providers = category
      ? this.PROVIDERS.filter((p) => p.category === category)
      : this.PROVIDERS;

    const savedRecords = db.getConnectors(context.tenant.id, category);

    const safeConfigurations = savedRecords.map((rec) => {
      const { credentials_encrypted: _, ...safeRec } = rec;
      return safeRec;
    });

    // Compute stats
    const allRecords = db.getConnectors(context.tenant.id);
    const totalActive = allRecords.filter((r) => r.status === "ACTIVE").length;

    const byCategory: Record<ConnectorCategory, { available: number; active: number }> = {
      AI_LLM: { available: 0, active: 0 },
      VECTOR_DB: { available: 0, active: 0 },
      REDIS_CACHE: { available: 0, active: 0 },
      SOCIAL_ADS: { available: 0, active: 0 },
      LOGISTICS: { available: 0, active: 0 },
      DATABASE: { available: 0, active: 0 },
      ENTERPRISE: { available: 0, active: 0 },
    };

    for (const p of this.PROVIDERS) {
      if (byCategory[p.category]) {
        byCategory[p.category].available++;
      }
    }
    for (const r of allRecords) {
      if (byCategory[r.category] && r.status === "ACTIVE") {
        byCategory[r.category].active++;
      }
    }

    return {
      providers,
      configurations: safeConfigurations,
      stats: {
        total_available: this.PROVIDERS.length,
        total_active: totalActive,
        by_category: byCategory,
      },
    };
  }

  /**
   * A provider that isn't in the catalog (removed, or never existed) or is COMING_SOON can't be saved or tested.
   * Records saved for a since-removed provider stay readable and can be deleted.
   */
  private static assertConnectable(provider: ConnectorProviderDefinition | undefined, providerId: string): asserts provider is ConnectorProviderDefinition {
    if (!provider) {
      throw new BadRequestError(`Connector provider '${providerId}' is not supported (PROVIDER_NOT_SUPPORTED).`);
    }
    if (provider.status === "COMING_SOON") {
      throw new BadRequestError(`${provider.name} is coming soon and can't be connected yet (PROVIDER_NOT_AVAILABLE).`);
    }
  }

  /**
   * Save or update a connector configuration with AES-256-GCM encryption
   */
  public static async saveConnector(
    context: RequestContext,
    payload: SaveConnectorPayload
  ): Promise<Omit<ConnectorConfigRecord, "credentials_encrypted">> {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);
    const parsed = SaveConnectorSchema.parse(payload);

    const provider = this.PROVIDERS.find((p) => p.id === parsed.provider_id);
    this.assertConnectable(provider, parsed.provider_id);

    // Encrypt sensitive credentials
    const credentialsToEncrypt: Record<string, unknown> = { ...parsed.credentials };
    const encryptedCredentials = encryptCredential(credentialsToEncrypt);

    // Build masked credentials for UI
    const maskedCredentials: Record<string, string> = {};
    for (const [key, val] of Object.entries(parsed.credentials)) {
      if (typeof val === "string") {
        maskedCredentials[key] = maskSecret(val);
      } else {
        maskedCredentials[key] = "••••••••";
      }
    }

    const existing = db.findConnectorByProvider(context.tenant.id, provider.id);
    const now = new Date().toISOString();

    const record: ConnectorConfigRecord = {
      id: existing ? existing.id : `conn_${provider.id}_${Date.now()}_${randomSuffix()}`,
      tenant_id: context.tenant.id,
      provider_id: provider.id,
      category: provider.category,
      name: parsed.name || provider.name,
      endpoint_url: parsed.endpoint_url || provider.default_endpoint,
      default_model: parsed.default_model || provider.suggested_models?.[0],
      credentials_encrypted: encryptedCredentials,
      credentials_masked: maskedCredentials,
      configuration: parsed.configuration || {},
      status: "ACTIVE",
      // Saved, not tested: this was HEALTHY with a random 35-80 ms latency (FX-31)
      health_status: "UNVERIFIED",
      last_test_latency_ms: null,
      created_at: existing ? existing.created_at : now,
      updated_at: now,
    };

    const saved = db.saveConnector(record);

    // If enterprise provider, synchronize with integration_installations for backward-compatibility with Phase 9 views
    if (provider.category === "ENTERPRISE") {
      try {
        const stringCreds: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed.credentials)) {
          stringCreds[k] = String(v);
        }
        // Only this workspace's own installation; there is no fallback to the shared demo organization (FX-13).
        const existingInst = db.getIntegrationInstallations(context.tenant.id).find((i) => i.provider_id === provider.id);

        const entCategory: "ERP" | "CRM" | "ACCOUNTING" | "MARKETPLACE" =
          provider.id.includes("sap") || provider.id.includes("netsuite")
            ? "ERP"
            : provider.id.includes("salesforce") || provider.id.includes("hubspot")
            ? "CRM"
            : "MARKETPLACE";

        if (existingInst) {
          db.updateIntegrationInstallation(existingInst.organization_id, existingInst.id, {
            status: "NOT_VERIFIED",
            credentials_encrypted: encryptedCredentials,
            sync_frequency_minutes: Number(parsed.credentials.sync_frequency_minutes || 15),
            updated_at: now,
          });
        } else {
          db.createIntegrationInstallation({
            id: `inst_${provider.id.replace("prov_", "")}_${Date.now()}_${randomSuffix()}`,
            organization_id: context.tenant.id,
            provider_id: provider.id,
            provider_name: provider.name,
            category: entCategory,
            status: "NOT_VERIFIED",
            credentials_encrypted: encryptedCredentials,
            config: parsed.configuration || {},
            sync_frequency_minutes: Number(parsed.credentials.sync_frequency_minutes || 15),
            created_at: now,
            updated_at: now,
          });
        }
      } catch {
        // Non-blocking sync
      }
    }

    // Record audit log
    db.createAuditLog({
      id: `aud_${Date.now()}_connector_saved_${randomSuffix()}`,
      tenant_id: context.tenant.id,
      actor_user_id: context.user.id,
      action: existing ? "CONNECTOR_UPDATED" : "CONNECTOR_CREATED",
      resource_type: "connector",
      resource_id: saved.id,
      metadata: {
        provider_id: provider.id,
        category: provider.category,
        model: record.default_model,
      },
      created_at: now,
    });

    const { credentials_encrypted: _, ...safeSaved } = saved;
    return safeSaved;
  }

  /**
   * Real-time Test Connection & Health Verification
   */
  public static async testConnection(
    context: RequestContext,
    payload: TestConnectionPayload
  ): Promise<TestConnectionResult> {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_READ);
    const parsed = TestConnectionSchema.parse(payload);

    const provider = this.PROVIDERS.find((p) => p.id === parsed.provider_id);
    this.assertConnectable(provider, parsed.provider_id);

    // Category-specific connection validation
    if (provider.category === "AI_LLM") {
      const apiKey = String(parsed.credentials.api_key || parsed.credentials.bearer_token || "");
      const endpoint = parsed.endpoint_url || provider.default_endpoint;
      const model = parsed.default_model || provider.suggested_models?.[0];

      if (provider.id === "ollama" || provider.id === "vllm") {
        if (!endpoint) {
          throw new BadRequestError("Server endpoint URL is required for self-hosted LLMs.");
        }
      } else if (!apiKey && provider.id !== "ollama") {
        throw new BadRequestError(`API key is required to test ${provider.name}.`);
      }

      return this.liveOrNotVerified(provider, parsed, { endpoint, model });
    }

    if (provider.category === "SOCIAL_ADS") {
      if (provider.id === "meta_graph") {
        const appId = String(parsed.credentials.app_id || "");
        const pageToken = String(parsed.credentials.page_access_token || "");
        if (!appId || !pageToken) {
          throw new BadRequestError("Meta App ID and Page Access Token are required.");
        }
      } else if (provider.id === "google_ads") {
        const custId = String(parsed.credentials.customer_id || "");
        const devToken = String(parsed.credentials.developer_token || "");
        if (!custId || !devToken) {
          throw new BadRequestError("Google Ads Customer ID and Developer Token are required.");
        }
      } else if (provider.id === "whatsapp_cloud") {
        const phoneId = String(parsed.credentials.phone_number_id || "");
        if (!phoneId) {
          throw new BadRequestError("WhatsApp Phone Number ID is required.");
        }
      } else if (provider.id === "telegram") {
        const botToken = String(parsed.credentials.bot_token || "");
        if (!botToken) {
          throw new BadRequestError("Telegram Bot Token is required (format: 123456789:ABC-DEF...).");
        }
      }

      return this.liveOrNotVerified(provider, parsed);
    }

    if (provider.category === "LOGISTICS") {
      if (provider.id === "steadfast") {
        const apiKey = String(parsed.credentials.api_key || "");
        const secretKey = String(parsed.credentials.secret_key || "");
        if (!apiKey || !secretKey) {
          throw new BadRequestError("Steadfast API Key and Secret Key are required.");
        }
      } else if (provider.id === "pathao") {
        const clientId = String(parsed.credentials.client_id || "");
        const storeId = String(parsed.credentials.store_id || "");
        if (!clientId || !storeId) {
          throw new BadRequestError("Pathao Client ID and Store ID are required.");
        }
      }

      return this.liveOrNotVerified(provider, parsed);
    }

    if (provider.category === "VECTOR_DB") {
      const endpoint = parsed.endpoint_url || String(parsed.credentials.endpoint_url || "");
      if (!endpoint) {
        throw new BadRequestError(`Endpoint URL is required for ${provider.name}.`);
      }
      return this.liveOrNotVerified(provider, parsed);
    }

    if (provider.category === "ENTERPRISE") {
      if (provider.id === "prov_google_sheets") {
        const sheetUrl = String(parsed.credentials.spreadsheet_url || parsed.credentials.spreadsheet_id || "");
        if (!sheetUrl) {
          throw new BadRequestError("Google Spreadsheet Link or ID is required.");
        }
        const { GoogleSheetHelper } = await import("@/lib/google-sheet");
        const sheetId = GoogleSheetHelper.extractSpreadsheetId(sheetUrl);
        const sheetName = String(parsed.credentials.sheet_name || "Products");

        return this.liveOrNotVerified(provider, parsed, { spreadsheet_id: sheetId, sheet_name: sheetName });
      }

      const authVal = String(
        parsed.credentials.client_id ||
        parsed.credentials.consumer_key ||
        parsed.credentials.access_token ||
        parsed.credentials.app_key ||
        ""
      );

      if (!authVal) {
        throw new BadRequestError(`Authentication credentials (Client ID, App Key, or Access Token) are required for ${provider.name}.`);
      }

      return this.liveOrNotVerified(provider, parsed);
    }

    return this.liveOrNotVerified(provider, parsed);
  }

  /**
   * The provider's live auth check (FX-53) when one exists, otherwise NOT_VERIFIED. Fields were validated by the caller.
   */
  private static async liveOrNotVerified(
    provider: ConnectorProviderDefinition,
    parsed: { credentials: Record<string, unknown>; endpoint_url?: string },
    details?: Record<string, unknown>
  ): Promise<TestConnectionResult> {
    const live = await runLiveCheck({
      providerId: provider.id,
      providerName: provider.name,
      credentials: parsed.credentials,
      endpoint: parsed.endpoint_url,
      defaultEndpoint: provider.default_endpoint,
    });
    return live ? { ...live, details: { ...details, ...live.details } } : notVerified(provider.name, details);
  }

  /**
   * Delete / Disconnect a connector
   */
  public static async deleteConnector(
    context: RequestContext,
    id: string
  ): Promise<boolean> {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);

    const existing = db.findConnectorById(context.tenant.id, id);
    if (!existing) {
      throw new NotFoundError(`Connector configuration '${id}' not found.`);
    }

    const removed = db.deleteConnector(context.tenant.id, id);

    if (existing.category === "ENTERPRISE") {
      try {
        // Only this workspace's installations: deleting a connector used to disconnect every organization's (FX-13).
        const insts = db.data.integration_installations.filter(
          (i) => i.provider_id === existing.provider_id && i.organization_id === context.tenant.id
        );
        for (const inst of insts) {
          db.updateIntegrationInstallation(inst.organization_id, inst.id, {
            status: "DISCONNECTED",
            updated_at: new Date().toISOString(),
          });
        }
      } catch {
        // Non-blocking
      }
    }


    db.createAuditLog({
      id: `aud_${Date.now()}_connector_deleted_${randomSuffix()}`,
      tenant_id: context.tenant.id,
      actor_user_id: context.user.id,
      action: "CONNECTOR_DELETED",
      resource_type: "connector",
      resource_id: id,
      metadata: {
        provider_id: existing.provider_id,
        category: existing.category,
      },
      created_at: new Date().toISOString(),
    });

    return removed;
  }
}
