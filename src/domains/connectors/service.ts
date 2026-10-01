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
import { ChannelService } from "@/domains/social/channels/channel.service";
import { telegramCall } from "@/domains/social/channels/adapters/telegram.adapter";
import { appBaseUrl } from "@/domains/social/n8n/bridge";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import crypto from "crypto";

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
    if (provider.id === "telegram") {
      // The webhook secret is generated by the set-webhook action, never typed in: a re-save keeps the generated one
      delete credentialsToEncrypt.webhook_secret;
      const previous = db.findConnectorByProvider(context.tenant.id, provider.id);
      if (previous) {
        try {
          const prev = decryptCredential<Record<string, unknown>>(previous.credentials_encrypted);
          if (typeof prev.webhook_secret === "string" && prev.webhook_secret) credentialsToEncrypt.webhook_secret = prev.webhook_secret;
        } catch {
          // unreadable old credentials: a new secret is generated by set-webhook
        }
      }
    }
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

    // A messaging connector feeds a social channel (connector plan D3); the channel reads its credentials from here
    if (provider.id === "telegram") {
      ChannelService.ensureChannelForTelegramConnector(context.tenant.id, saved);
    }

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
   * Provider setup actions the connector page offers. Telegram: "set-webhook" registers this app's webhook with a
   * generated secret_token (stored encrypted in the connector, never shown), "webhook-info" reports what Telegram has.
   */
  public static async runAction(context: RequestContext, connectorId: string, action: string): Promise<Record<string, unknown>> {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);
    await enforceRateLimit(`connector-action:${context.tenant.id}`, 10, MINUTE);
    const connector = db.findConnectorById(context.tenant.id, connectorId);
    if (!connector) throw new NotFoundError(`Connector configuration '${connectorId}' not found.`);
    if (connector.provider_id !== "telegram") throw new BadRequestError("This connector has no setup actions.");
    const credentials = decryptCredential<Record<string, unknown>>(connector.credentials_encrypted);
    const base = appBaseUrl();
    const webhookUrl = base ? `${base}/api/v1/connectors/${connector.id}/webhook` : null;

    if (action === "webhook-info") {
      const info = await telegramCall(credentials, "getWebhookInfo", {});
      return {
        webhook_set: Boolean(info.url),
        webhook_matches_this_app: webhookUrl !== null && info.url === webhookUrl,
        pending_update_count: typeof info.pending_update_count === "number" ? info.pending_update_count : 0,
        last_error: typeof info.last_error_message === "string" ? info.last_error_message.slice(0, 160) : null,
      };
    }

    if (action === "set-webhook") {
      if (!webhookUrl || !webhookUrl.startsWith("https://")) {
        throw new BadRequestError("APP_URL must be set to this app's public https address before Telegram's webhook can be registered.");
      }
      const secret = typeof credentials.webhook_secret === "string" && credentials.webhook_secret ? credentials.webhook_secret : crypto.randomBytes(32).toString("base64url");
      await telegramCall(credentials, "setWebhook", {
        url: webhookUrl,
        secret_token: secret,
        allowed_updates: ["message", "callback_query"],
        max_connections: 20,
      });
      const now = new Date().toISOString();
      const nextCredentials = { ...credentials, webhook_secret: secret };
      db.saveConnector({
        ...connector,
        credentials_encrypted: encryptCredential(nextCredentials),
        configuration: { ...connector.configuration, webhook_set_at: now },
        updated_at: now,
      });
      db.createAuditLog({
        id: `aud_${Date.now()}_connector_action_${randomSuffix()}`,
        tenant_id: context.tenant.id,
        actor_user_id: context.user.id,
        action: "CONNECTOR_ACTION",
        resource_type: "connector",
        resource_id: connector.id,
        metadata: { provider_id: connector.provider_id, connector_action: action },
        created_at: now,
      });
      return { status: "WEBHOOK_SET", webhook_url: webhookUrl };
    }

    throw new BadRequestError(`Unknown action '${action}'.`);
  }

  /**
   * Rotate the webhook secret for a connector (connector plan C3, §6).
   * The new secret is returned once; it is stored encrypted and never shown again.
   */
  public static async rotateSecret(context: RequestContext, connectorId: string): Promise<{ secret: string }> {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);
    const connector = db.findConnectorById(context.tenant.id, connectorId);
    if (!connector) throw new NotFoundError(`Connector configuration '${connectorId}' not found.`);
    const credentials = decryptCredential<Record<string, unknown>>(connector.credentials_encrypted);
    const newSecret = crypto.randomBytes(32).toString("base64url");
    const now = new Date().toISOString();
    db.saveConnector({
      ...connector,
      credentials_encrypted: encryptCredential({ ...credentials, webhook_secret: newSecret }),
      configuration: { ...connector.configuration, webhook_secret_rotated_at: now },
      updated_at: now,
    });
    db.createAuditLog({
      id: `aud_${Date.now()}_connector_rotate_secret_${randomSuffix()}`,
      tenant_id: context.tenant.id,
      actor_user_id: context.user.id,
      action: "CONNECTOR_SECRET_ROTATED",
      resource_type: "connector",
      resource_id: connectorId,
      metadata: { provider_id: connector.provider_id },
      created_at: now,
    });
    return { secret: newSecret };
  }

  /**
   * Enable or disable a connector without deleting it (connector plan C3, §6).
   */
  public static async setEnabled(context: RequestContext, connectorId: string, enabled: boolean): Promise<{ id: string; enabled: boolean }> {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);
    const connector = db.findConnectorById(context.tenant.id, connectorId);
    if (!connector) throw new NotFoundError(`Connector configuration '${connectorId}' not found.`);
    const now = new Date().toISOString();
    db.saveConnector({ ...connector, enabled, updated_at: now });
    db.createAuditLog({
      id: `aud_${Date.now()}_connector_${enabled ? "enabled" : "disabled"}_${randomSuffix()}`,
      tenant_id: context.tenant.id,
      actor_user_id: context.user.id,
      action: enabled ? "CONNECTOR_ENABLED" : "CONNECTOR_DISABLED",
      resource_type: "connector",
      resource_id: connectorId,
      metadata: { provider_id: connector.provider_id },
      created_at: now,
    });
    return { id: connectorId, enabled };
  }

  /**
   * Record the result of a connector API call (connector plan C3, §5).
   * Updates last_success_at, last_failure_at, consecutive_failures, last_error_code.
   * A 401/190 from Meta flips the connector to ERROR with TOKEN_EXPIRED.
   */
  public static recordCallResult(
    connectorId: string,
    success: boolean,
    errorCode?: string,
    errorMessage?: string
  ): void {
    const connector = db.findConnectorForIngress(connectorId);
    if (!connector) return;
    const now = new Date().toISOString();
    const updates: Partial<ConnectorConfigRecord> = {
      last_success_at: success ? now : connector.last_success_at,
      last_failure_at: success ? connector.last_failure_at : now,
      consecutive_failures: success ? 0 : (connector.consecutive_failures ?? 0) + 1,
      last_error_code: success ? undefined : errorCode,
      last_error: success ? undefined : errorMessage?.slice(0, 200),
      updated_at: now,
    };
    // A 401 or 190 (Meta token expired) flips the connector to ERROR
    if (!success && (errorCode === "TOKEN_EXPIRED" || errorCode === "UNAUTHORIZED")) {
      updates.status = "ERROR";
      updates.health_status = "DOWN";
    }
    db.saveConnector({ ...connector, ...updates } as ConnectorConfigRecord);
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
