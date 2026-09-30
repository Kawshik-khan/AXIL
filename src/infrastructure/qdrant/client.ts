/**
 * CommerceOS — Qdrant Vector Database Client
 * Vector search for RAG knowledge retrieval, over Qdrant's REST API (no SDK dependency).
 *
 * Credentials come from the platform environment only (QDRANT_URL, QDRANT_API_KEY, QDRANT_COLLECTION). A tenant-supplied
 * URL is never fetched from the server (SSRF), so the tenant "qdrant" connector entry does not redirect this client.
 *
 * Tenant isolation: every point carries `tenant_id` in its payload, and every search and delete is filtered by it. Point
 * ids are derived from (tenant, chunk id), so two tenants can never overwrite each other's points.
 */

import { createHash } from "node:crypto";

// ── Metadata Schema ────────────────────────────────────────────
export interface KnowledgeChunkMetadata {
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

export interface QdrantCredentials {
  url: string;
  apiKey?: string;
  collection: string;
}

const REQUEST_TIMEOUT_MS = 15_000;
const UPSERT_BATCH_SIZE = 100;
const DEFAULT_COLLECTION = "commerceos_knowledge";

/** Collections already verified to exist by this process, keyed by url + collection. */
const _ensured = new Set<string>();

export function clearQdrantCache(): void {
  _ensured.clear();
  _indexed.clear();
}

export function resolveQdrantCredentials(): QdrantCredentials | null {
  const url = process.env.QDRANT_URL?.trim();
  if (!url) return null;
  return {
    url: url.replace(/\/+$/, ""),
    apiKey: process.env.QDRANT_API_KEY?.trim() || undefined,
    collection: process.env.QDRANT_COLLECTION?.trim() || DEFAULT_COLLECTION,
  };
}

/** Qdrant is platform-wide; the tenant argument is kept so callers check per tenant like every other integration. */
export function isQdrantConfigured(_tenantId?: string): boolean {
  return resolveQdrantCredentials() !== null;
}

function requireCredentials(): QdrantCredentials {
  const creds = resolveQdrantCredentials();
  if (!creds) throw new Error("Qdrant is not configured. Set QDRANT_URL (and QDRANT_API_KEY for Qdrant Cloud).");
  return creds;
}

async function request<T>(creds: QdrantCredentials, method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<T | null> {
  const res = await fetch(`${creds.url}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(creds.apiKey ? { "api-key": creds.apiKey } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (okStatuses.includes(res.status)) return null;
  if (!res.ok) {
    // Qdrant's error text is a short status message (e.g. a vector size mismatch); it carries no credentials
    const detail = await res.json().then((j: { status?: { error?: string } }) => j.status?.error, () => undefined);
    throw new Error(`Qdrant ${method} ${path.split("?")[0]} answered HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 200)}` : "."}`);
  }
  return (await res.json()) as T;
}

/** Qdrant point ids must be a UUID or an unsigned integer: derive a stable UUID from the tenant and chunk id. */
function pointId(tenantId: string, chunkId: string): string {
  const h = createHash("sha256").update(`${tenantId}\u0000${chunkId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function tenantFilter(tenantId: string, documentId?: string) {
  const must: Array<{ key: string; match: { value: string } }> = [{ key: "tenant_id", match: { value: tenantId } }];
  if (documentId) must.push({ key: "document_id", match: { value: documentId } });
  return { must };
}

const _indexed = new Set<string>();

/** Qdrant Cloud refuses filters on unindexed payload fields, so make sure the fields we filter on are indexed. */
async function ensureIndexes(creds: QdrantCredentials): Promise<void> {
  const key = `${creds.url}|${creds.collection}`;
  if (_indexed.has(key)) return;
  const name = encodeURIComponent(creds.collection);
  for (const field of ["tenant_id", "document_id"]) {
    await request(creds, "PUT", `/collections/${name}/index?wait=true`, { field_name: field, field_schema: "keyword" }, [404]);
  }
  _indexed.add(key);
}

/** Creates the collection (cosine) on first use, and makes sure the filter fields are indexed. */
async function ensureCollection(creds: QdrantCredentials, vectorSize: number): Promise<void> {
  const key = `${creds.url}|${creds.collection}`;
  if (!_ensured.has(key)) {
    const name = encodeURIComponent(creds.collection);
    const existing = await request(creds, "GET", `/collections/${name}`, undefined, [404]);
    if (existing === null) {
      await request(creds, "PUT", `/collections/${name}`, { vectors: { size: vectorSize, distance: "Cosine" } });
    }
    _ensured.add(key);
  }
  await ensureIndexes(creds);
}

// ── Vector Operations ──────────────────────────────────────────

export interface UpsertChunkParams {
  id: string;
  values: number[];
  metadata: KnowledgeChunkMetadata;
}

/**
 * Upsert knowledge chunks for a tenant. The tenant id in every payload comes from the caller's argument, never from the
 * chunk metadata, so a chunk cannot be written into another tenant's partition.
 */
export async function upsertChunks(tenantId: string, chunks: UpsertChunkParams[]): Promise<void> {
  if (chunks.length === 0) return;
  const creds = requireCredentials();
  await ensureCollection(creds, chunks[0].values.length);
  const name = encodeURIComponent(creds.collection);

  for (let i = 0; i < chunks.length; i += UPSERT_BATCH_SIZE) {
    const points = chunks.slice(i, i + UPSERT_BATCH_SIZE).map((c) => ({
      id: pointId(tenantId, c.id),
      vector: c.values,
      payload: { ...c.metadata, tenant_id: tenantId, chunk_id: c.id },
    }));
    await request(creds, "PUT", `/collections/${name}/points?wait=true`, { points });
  }
}

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: KnowledgeChunkMetadata;
}

interface QdrantSearchHit {
  score: number;
  payload?: (KnowledgeChunkMetadata & { chunk_id?: string }) | null;
}

/** Query a tenant's vectors. Returns top-K results by cosine similarity, at or above `minScore`. */
export async function searchVectors(tenantId: string, queryVector: number[], topK: number = 5, minScore: number = 0.65): Promise<VectorSearchResult[]> {
  const creds = requireCredentials();
  const name = encodeURIComponent(creds.collection);
  await ensureIndexes(creds);

  const response = await request<{ result: QdrantSearchHit[] }>(creds, "POST", `/collections/${name}/points/search`, {
    vector: queryVector,
    limit: topK,
    score_threshold: minScore,
    with_payload: true,
    filter: tenantFilter(tenantId),
  }, [404]);

  const results: VectorSearchResult[] = [];
  for (const hit of response?.result ?? []) {
    const meta = hit.payload;
    // Defence in depth: the server-side filter already scopes to the tenant
    if (!meta || meta.tenant_id !== tenantId || hit.score < minScore) continue;
    results.push({ id: meta.chunk_id ?? "", score: Number(hit.score.toFixed(4)), metadata: meta });
  }
  return results;
}

/** Delete all vectors of one document within a tenant. */
export async function deleteDocumentVectors(tenantId: string, documentId: string): Promise<void> {
  const creds = requireCredentials();
  const name = encodeURIComponent(creds.collection);
  await ensureIndexes(creds);
  await request(creds, "POST", `/collections/${name}/points/delete?wait=true`, { filter: tenantFilter(tenantId, documentId) }, [404]);
}

/** Delete every vector of a tenant (tenant deletion/cleanup). */
export async function deleteTenantVectors(tenantId: string): Promise<void> {
  const creds = requireCredentials();
  const name = encodeURIComponent(creds.collection);
  await ensureIndexes(creds);
  await request(creds, "POST", `/collections/${name}/points/delete?wait=true`, { filter: tenantFilter(tenantId) }, [404]);
}

/** Collection statistics for monitoring. */
export async function getCollectionStats() {
  const creds = requireCredentials();
  return request<{ result: { points_count?: number; status?: string; config?: { params?: { vectors?: { size?: number } & Record<string, { size?: number }> } } } }>(creds, "GET", `/collections/${encodeURIComponent(creds.collection)}`, undefined, [404]);
}

/** Health check for Qdrant connectivity. A collection that doesn't exist yet is fine: it is created on first ingest. */
export async function healthCheck(): Promise<{ ok: boolean; latencyMs: number; message?: string }> {
  const start = Date.now();
  try {
    if (!isQdrantConfigured()) return { ok: false, latencyMs: 0, message: "QDRANT_NOT_CONFIGURED" };
    await getCollectionStats();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, message: err instanceof Error ? err.message : String(err) };
  }
}
