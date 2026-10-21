import { z } from "zod";

export type ConnectorCategory =
  | "AI_LLM"
  | "VECTOR_DB"
  | "REDIS_CACHE"
  | "SOCIAL_ADS"
  | "LOGISTICS"
  | "DATABASE"
  | "ENTERPRISE";

export type ConnectorStatus = "ACTIVE" | "NOT_CONFIGURED" | "ERROR" | "TESTING";

/** UNVERIFIED: credentials saved but never checked with the provider (FX-31). */
export type ConnectorHealth = "HEALTHY" | "DEGRADED" | "DOWN" | "UNKNOWN" | "UNVERIFIED";

export interface ConnectorFieldDefinition {
  name: string;
  label: string;
  type: "text" | "password" | "url" | "select" | "number" | "boolean";
  placeholder?: string;
  required?: boolean;
  description?: string;
  options?: Array<{ label: string; value: string }>;
  defaultValue?: string | number | boolean;
}

export interface ConnectorGuideline {
  prerequisites: string[];
  steps: string[];
  portal_url: string;
  webhook_info?: string;
  terminal_commands?: string[];
  tips?: string[];
}

/**
 * BETA: connectable; credentials are saved encrypted and checked with the provider where a live check exists.
 * LIVE: BETA plus a recorded live verification of the feature the connector serves (none yet).
 * COMING_SOON: listed, not connectable.
 */
export type ConnectorProviderStatus = "LIVE" | "BETA" | "COMING_SOON";

/** What a connector lets the product do; features ask for a capability, not for a provider (connector plan, section 4). */
export type ConnectorCapability =
  | "LLM_CHAT"
  | "EMBEDDINGS"
  | "VECTOR_STORE"
  | "MESSAGING"
  | "COURIER"
  | "PAYMENT"
  | "CACHE"
  | "CRM_SYNC"
  | "CATALOG_IMPORT";

/**
 * How a merchant connects a provider (ADR-119). The connector page picks the flow from this:
 * oauth2 = sign in with the provider in a popup; embedded_signup = the provider's own signup popup (WhatsApp);
 * api_key = a short form checked live; bot_token = paste a bot token, webhook set automatically.
 */
export type ConnectorAuthMethod = "oauth2" | "embedded_signup" | "api_key" | "bot_token";

/** What a connection reaches at the provider (ADR-119). */
export type ConnectionResourceKind =
  | "FB_PAGE"
  | "IG_ACCOUNT"
  | "AD_ACCOUNT"
  | "WA_NUMBER"
  | "TELEGRAM_BOT"
  | "COURIER_STORE"
  | "SHOP";

export const CONNECTION_RESOURCE_KINDS: readonly ConnectionResourceKind[] = [
  "FB_PAGE",
  "IG_ACCOUNT",
  "AD_ACCOUNT",
  "WA_NUMBER",
  "TELEGRAM_BOT",
  "COURIER_STORE",
  "SHOP",
];

/**
 * Kinds one workspace at most may hold live (audit H5): inbound webhooks are routed by their id, so a second holder could
 * receive another shop's messages. Ad accounts, courier stores and shops may be shared; the provider enforces access.
 */
export const EXCLUSIVE_RESOURCE_KINDS: ReadonlySet<ConnectionResourceKind> = new Set<ConnectionResourceKind>([
  "FB_PAGE",
  "IG_ACCOUNT",
  "WA_NUMBER",
  "TELEGRAM_BOT",
]);

/** Extra scopes a feature asks for when the merchant turns it on (incremental consent, ADR-119 E5). */
export interface ConnectorOptionalScopes {
  feature: string;
  scopes: string[];
}

/**
 * What the merchant wants a connector for (ADR-119 P6): the Connectors page groups by this. PLATFORM = infrastructure
 * (AI models, vector stores) shown only in the platform view.
 */
export type ConnectorGoal = "SELL_CHAT" | "DELIVER" | "GET_PAID" | "ADS" | "SELL_MORE" | "PLATFORM";

export interface ConnectorProviderDefinition {
  id: string;
  name: string;
  category: ConnectorCategory;
  goal: ConnectorGoal;
  status: ConnectorProviderStatus;
  capabilities: ConnectorCapability[];
  auth_method: ConnectorAuthMethod;
  /** oauth2 / embedded_signup: scopes asked at connect. */
  base_scopes?: string[];
  optional_scopes?: ConnectorOptionalScopes[];
  /** What the merchant picks after connecting; empty for a plain API-key connector with nothing to pick. */
  resource_kinds: ConnectionResourceKind[];
  badge?: string;
  description: string;
  documentation_url: string;
  portal_url: string;
  default_endpoint?: string;
  suggested_models?: string[];
  fields: ConnectorFieldDefinition[];
  guidelines: ConnectorGuideline;
}

export interface ConnectorConfigRecord {
  id: string;
  tenant_id: string;
  provider_id: string;
  category: ConnectorCategory;
  name: string;
  endpoint_url?: string;
  default_model?: string;
  credentials_encrypted: string;
  credentials_masked: Record<string, string>;
  configuration: Record<string, unknown>;
  status: ConnectorStatus;
  health_status: ConnectorHealth;
  last_tested_at?: string;
  last_test_latency_ms?: number | null;
  last_error?: string;
  /** Added by the connector plan (C0): optional, so records saved before it stay valid; reads default them. */
  schema_version?: number;
  capabilities?: ConnectorCapability[];
  external_account_id?: string;
  last_success_at?: string;
  last_failure_at?: string;
  consecutive_failures?: number;
  last_error_code?: string;
  verified_at?: string;
  enabled?: boolean;
  /** Added by the connection platform (ADR-119): optional, so rows saved before it stay valid. */
  auth_method?: ConnectorAuthMethod;
  /** The member who granted it; their tokens are deleted when they leave the workspace (E8). */
  owner_user_id?: string;
  /** As the provider reports them (token inspection), never as requested. */
  scopes_granted?: string[];
  token_expires_at?: string;
  connection_status?: ConnectionStatus;
  health_checked_at?: string;
  /** A code (TOKEN_EXPIRED, WEBHOOK_SILENT, ...), never provider text. */
  health_code?: string;
  created_at: string;
  updated_at: string;
}

/** Lifecycle of a connection (ADR-119). A sign-in not yet activated lives only in the pending cookie, never here. */
export type ConnectionStatus = "ACTIVE" | "DEGRADED" | "NEEDS_REAUTH" | "DISCONNECTED";

export type ConnectionResourceStatus = "ACTIVE" | "NEEDS_ATTENTION" | "DETACHED";

/** Something a connection reaches at the provider: a Page, an ad account, a WhatsApp number (collection `connection_resources`). */
export interface ConnectionResource {
  id: string;
  tenant_id: string;
  /** The `connector_configurations` row (the connection) this came from. */
  connection_id: string;
  kind: ConnectionResourceKind;
  /** The provider's id (Page id, ad account digits without `act_`, phone number id). */
  external_id: string;
  name: string;
  /** Non-secret provider facts for display: currency, username. */
  metadata: Record<string, string | number | boolean>;
  /** Only for resources with their own token (a Page token). Encrypted with encryptCredential. */
  token_encrypted?: string;
  status: ConnectionResourceStatus;
  activated_at?: string;
  last_event_at?: string;
  created_at: string;
  updated_at: string;
}

export interface SaveConnectorPayload {
  provider_id: string;
  name?: string;
  endpoint_url?: string;
  default_model?: string;
  credentials: Record<string, unknown>;
  configuration?: Record<string, unknown>;
}

export interface TestConnectionPayload {
  provider_id: string;
  endpoint_url?: string;
  default_model?: string;
  credentials: Record<string, unknown>;
  configuration?: Record<string, unknown>;
}

export interface TestConnectionResult {
  success: boolean;
  /** VERIFIED: the provider answered. NOT_VERIFIED: no live test exists for it. FAILED: the provider refused or was unreachable. */
  status: "VERIFIED" | "NOT_VERIFIED" | "FAILED";
  /** Measured round trip; null when nothing was contacted. */
  latency_ms: number | null;
  message: string;
  details?: Record<string, unknown>;
}

export const SaveConnectorSchema = z.object({
  provider_id: z.string().min(1, "Provider ID is required"),
  name: z.string().optional(),
  endpoint_url: z.string().url("Invalid endpoint URL").optional().or(z.literal("")),
  default_model: z.string().optional(),
  credentials: z.record(z.unknown()),
  configuration: z.record(z.unknown()).optional(),
});

export const TestConnectionSchema = z.object({
  provider_id: z.string().min(1, "Provider ID is required"),
  endpoint_url: z.string().optional().or(z.literal("")),
  default_model: z.string().optional(),
  credentials: z.record(z.unknown()),
  configuration: z.record(z.unknown()).optional(),
});
