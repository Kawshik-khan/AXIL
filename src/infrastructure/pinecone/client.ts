/**
 * CommerceOS — Pinecone Vector Database Client
 * Managed vector search for RAG knowledge retrieval.
 * 
 * Dynamically resolves credentials from:
 * 1. Tenant's encrypted connector configuration in database (AES-256-GCM)
 * 2. Platform environment variable fallback (PINECONE_API_KEY)
 * 
 * Tenant isolation is enforced via Pinecone namespaces —
 * each tenant's vectors live in a physically separate namespace.
 */

import { Pinecone, Index, RecordMetadata } from '@pinecone-database/pinecone';
import { db } from '@/infrastructure/db';
import { decryptCredential } from '@/lib/security';

// ── Metadata Schema ────────────────────────────────────────────
export interface KnowledgeChunkMetadata extends RecordMetadata {
  tenant_id: string;
  document_id: string;
  document_title: string;
  document_type: string;
  section_heading: string;
  chunk_index: number;
  version: number;
  language: string;
  content: string; // Full chunk text stored for retrieval without DB roundtrip
  parent_chunk_id: string;
}

export interface PineconeCredentials {
  apiKey: string;
  indexName: string;
  indexHost?: string;
  source: "CONNECTOR" | "ENV";
}

// ── Multi-Tenant Client & Index Cache ──────────────────────────
const _clientCache = new Map<string, { client: Pinecone; index: Index<KnowledgeChunkMetadata> }>();

export function clearPineconeCache(): void {
  _clientCache.clear();
}

/**
 * Resolves Pinecone credentials for a specific tenant:
 * 1. Checks tenant's active connector configuration in DB
 * 2. Falls back to PINECONE_API_KEY from environment
 */
export function resolvePineconeCredentials(tenantId?: string): PineconeCredentials | null {
  if (tenantId) {
    const connector = db.findConnectorByProvider(tenantId, "pinecone");
    if (connector && connector.status === "ACTIVE" && connector.credentials_encrypted) {
      try {
        const creds = decryptCredential<{
          api_key?: string;
          index_host?: string;
          index_name?: string;
        }>(connector.credentials_encrypted);

        if (creds && creds.api_key) {
          return {
            apiKey: creds.api_key,
            indexName: creds.index_name || (connector.configuration as any)?.index_name || "commerceos-knowledge",
            indexHost: creds.index_host || connector.endpoint_url,
            source: "CONNECTOR",
          };
        }
      } catch (err) {
        console.warn(`[Pinecone] Failed to decrypt connector credentials for tenant '${tenantId}':`, err);
      }
    }
  }

  // Fallback to environment variables
  const envKey = process.env.PINECONE_API_KEY;
  if (envKey) {
    return {
      apiKey: envKey,
      indexName: process.env.PINECONE_INDEX || "commerceos-knowledge",
      indexHost: process.env.PINECONE_INDEX_HOST,
      source: "ENV",
    };
  }

  return null;
}

/**
 * Checks if Pinecone is configured either for a specific tenant or globally.
 */
export function isPineconeConfigured(tenantId?: string): boolean {
  return resolvePineconeCredentials(tenantId) !== null;
}

/**
 * Gets or initializes a cached Pinecone client and index for the specified tenant.
 */
export function getPineconeForTenant(tenantId?: string): {
  client: Pinecone;
  index: Index<KnowledgeChunkMetadata>;
  credentials: PineconeCredentials;
} {
  const creds = resolvePineconeCredentials(tenantId);
  if (!creds || !creds.apiKey) {
    throw new Error(
      `Pinecone is not configured for tenant '${tenantId || "default"}'. Please configure it via Connector Hub or PINECONE_API_KEY.`
    );
  }

  const cacheKey = `${creds.apiKey}:${creds.indexName}:${creds.indexHost || ""}`;
  let cached = _clientCache.get(cacheKey);

  if (!cached) {
    const client = new Pinecone({ apiKey: creds.apiKey });
    const index = creds.indexHost
      ? client.index<KnowledgeChunkMetadata>(creds.indexName, creds.indexHost)
      : client.index<KnowledgeChunkMetadata>(creds.indexName);
    cached = { client, index };
    _clientCache.set(cacheKey, cached);
  }

  return { ...cached, credentials: creds };
}

/**
 * Get a tenant-scoped namespace.
 * Each tenant's vectors are isolated in their own namespace,
 * preventing any cross-tenant retrieval.
 */
export function tenantNamespace(tenantId: string) {
  const { index } = getPineconeForTenant(tenantId);
  return index.namespace(tenantId);
}

// ── Vector Operations ──────────────────────────────────────────

export interface UpsertChunkParams {
  id: string;
  values: number[];
  metadata: KnowledgeChunkMetadata;
}

/**
 * Upsert knowledge chunks into tenant namespace.
 * Pinecone handles deduplication by vector ID.
 */
export async function upsertChunks(
  tenantId: string,
  chunks: UpsertChunkParams[]
): Promise<void> {
  const ns = tenantNamespace(tenantId);

  // Pinecone recommends batches of 100
  const BATCH_SIZE = 100;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    await (ns as any).upsert(batch);
  }
}

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: KnowledgeChunkMetadata;
}

/**
 * Query vectors within a tenant namespace.
 * Returns top-K results sorted by cosine similarity.
 */
export async function searchVectors(
  tenantId: string,
  queryVector: number[],
  topK: number = 5,
  minScore: number = 0.65,
  filter?: Record<string, unknown>
): Promise<VectorSearchResult[]> {
  const ns = tenantNamespace(tenantId);

  const response = await ns.query({
    vector: queryVector,
    topK,
    includeMetadata: true,
    filter,
  });

  return (response.matches || [])
    .filter((match) => (match.score || 0) >= minScore)
    .map((match) => ({
      id: match.id,
      score: Number((match.score || 0).toFixed(4)),
      metadata: match.metadata as KnowledgeChunkMetadata,
    }));
}

/**
 * Delete all vectors for a specific document within a tenant namespace.
 */
export async function deleteDocumentVectors(
  tenantId: string,
  documentId: string
): Promise<void> {
  const ns = tenantNamespace(tenantId);
  await (ns as any).deleteMany({ document_id: { $eq: documentId } });
}

/**
 * Delete entire tenant namespace (for tenant deletion/cleanup).
 */
export async function deleteTenantNamespace(tenantId: string): Promise<void> {
  const ns = tenantNamespace(tenantId);
  await ns.deleteAll();
}

/**
 * Get index statistics for monitoring.
 */
export async function getIndexStats(tenantId?: string) {
  const { index } = getPineconeForTenant(tenantId);
  return index.describeIndexStats();
}

/**
 * Health check for Pinecone connectivity for a tenant or platform.
 */
export async function healthCheck(tenantId?: string): Promise<{ ok: boolean; latencyMs: number; message?: string }> {
  const start = Date.now();
  try {
    if (!isPineconeConfigured(tenantId)) {
      return { ok: false, latencyMs: 0, message: "PINECONE_NOT_CONFIGURED" };
    }
    await getIndexStats(tenantId);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - start, message: err.message };
  }
}
