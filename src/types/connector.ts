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

export interface ConnectorProviderDefinition {
  id: string;
  name: string;
  category: ConnectorCategory;
  status: ConnectorProviderStatus;
  capabilities: ConnectorCapability[];
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
