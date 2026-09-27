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

export type ConnectorHealth = "HEALTHY" | "DEGRADED" | "DOWN" | "UNKNOWN";

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

export interface ConnectorProviderDefinition {
  id: string;
  name: string;
  category: ConnectorCategory;
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
  last_test_latency_ms?: number;
  last_error?: string;
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
  latency_ms: number;
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
