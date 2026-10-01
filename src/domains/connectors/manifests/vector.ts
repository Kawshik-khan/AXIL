import type { ConnectorProviderDefinition } from "@/types/connector";

/**
 * Provider manifests, category VECTOR_DB. A manifest describes a provider (fields, guide, capabilities, status); behavior
 * belongs to its driver (connector plan, docs/connector-implementation-plan.md). Status: BETA = connectable and saved
 * encrypted, with a live credential check where one exists; COMING_SOON = listed but not connectable.
 */
export const VECTOR_DB_MANIFESTS: ConnectorProviderDefinition[] = [
  {
    id: "qdrant",
    name: "Qdrant (Vector Database)",
    category: "VECTOR_DB",
    status: "BETA",
    capabilities: ["VECTOR_STORE"],
    badge: "Rust Vector Engine",
    description: "High-performance vector similarity search engine with extended metadata filtering for tenant-isolated RAG and semantic catalog search.",
    default_endpoint: "http://localhost:6333",
    portal_url: "https://cloud.qdrant.io",
    documentation_url: "https://qdrant.tech/documentation",
    fields: [
      { name: "endpoint_url", label: "Qdrant Server Endpoint", type: "url", required: true, defaultValue: "http://localhost:6333", placeholder: "http://localhost:6333 or https://xyz.qdrant.tech" },
      { name: "api_key", label: "API Key (Optional for Self-Hosted)", type: "password", required: false, placeholder: "Key for Qdrant Cloud" },
      { name: "collection_name", label: "Collection Name", type: "text", required: true, defaultValue: "commerceos_rag_embeddings", placeholder: "commerceos_rag_embeddings" },
      { name: "vector_dimension", label: "Vector Dimension", type: "number", required: true, defaultValue: 1536, description: "1536 for OpenAI/Claude, 768 for Gemini, 384 for MiniLM" },
      { name: "distance_metric", label: "Distance Metric", type: "select", required: true, defaultValue: "Cosine", options: [
        { label: "Cosine Similarity (Standard RAG)", value: "Cosine" },
        { label: "Dot Product", value: "Dot" },
        { label: "Euclidean Distance", value: "Euclid" },
      ]},
    ],
    guidelines: {
      portal_url: "https://cloud.qdrant.io",
      prerequisites: [
        "Qdrant running in Docker or an active Qdrant Cloud cluster.",
      ],
      steps: [
        "For local: docker run -p 6333:6333 -p 6334:6334 qdrant/qdrant",
        "For cloud: Log into https://cloud.qdrant.io, create a free cluster, and copy the Cluster URL and API Key.",
        "Enter your collection name and vector dimension (1536 for standard embeddings).",
        "Click 'Test Connection' to verify collection status.",
      ],
      terminal_commands: [
        "docker run -d -p 6333:6333 -p 6334:6334 --name qdrant qdrant/qdrant",
      ],
      tips: [
        "Qdrant payload filters allow CommerceOS to filter by tenant_id at search time with zero cross-tenant leakage.",
      ],
    },
  },
];
