import type { ConnectorProviderDefinition } from "@/types/connector";
import { AI_LLM_MANIFESTS } from "./ai-llm";
import { SOCIAL_ADS_MANIFESTS } from "./social";
import { LOGISTICS_MANIFESTS } from "./logistics";
import { VECTOR_DB_MANIFESTS } from "./vector";
import { ENTERPRISE_MANIFESTS } from "./enterprise";

/** Every provider the connector catalog lists, in display order. */
export const PROVIDER_MANIFESTS: ConnectorProviderDefinition[] = [
  ...AI_LLM_MANIFESTS,
  ...SOCIAL_ADS_MANIFESTS,
  ...LOGISTICS_MANIFESTS,
  ...VECTOR_DB_MANIFESTS,
  ...ENTERPRISE_MANIFESTS,
];
