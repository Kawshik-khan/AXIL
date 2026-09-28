import crypto from "crypto";

/**
 * How a recomputed intelligence row merges with the stored row that has the same deterministic id (FX-21).
 * Used by the store when a recompute is saved and by GET reads that compute live, so both agree.
 *
 * Phase 2 security review M-1: a decision must stay attached to what was actually decided.
 * - A row a person is reviewing (its status is in `freeze`) is returned exactly as stored, so the content they approve
 *   is the content that was proposed.
 * - Decision fields (`keep`) carry over only while the stored row hasn't expired and it concerns the same entities.
 *   Otherwise the recomputed row starts again as a new proposal.
 */
export interface ComputedRowMergeSpec {
  keep?: readonly string[];
  freeze?: readonly string[];
}

type Row = Record<string, unknown>;

export function mergeComputedRow<T extends Row>(existing: Row, fresh: T, spec: ComputedRowMergeSpec, now = Date.now()): T {
  if (spec.freeze?.includes(String(existing.status))) return existing as T;
  const keep = spec.keep ?? [];
  if (keep.length === 0) {
    return (existing.created_at !== undefined ? { ...fresh, created_at: existing.created_at } : fresh) as T;
  }
  const expired = typeof existing.expires_at === "string" && Date.parse(existing.expires_at) <= now;
  if (expired || entityFingerprint(existing) !== entityFingerprint(fresh)) return fresh;
  const merged: Row = { ...fresh };
  if (existing.created_at !== undefined) merged.created_at = existing.created_at;
  for (const key of keep) if (existing[key] !== undefined) merged[key] = existing[key];
  return merged as T;
}

function entityFingerprint(row: Row): string {
  const entities = row.affected_entities;
  if (!Array.isArray(entities)) return "";
  return entities
    .map((e) => `${(e as Row)?.type ?? ""}:${(e as Row)?.id ?? ""}`)
    .sort()
    .join("|");
}

/** Short stable key for a set of entity ids, for ids of rows that concern a set (e.g. all dead-stock SKUs). */
export function entitySetKey(ids: readonly string[]): string {
  return crypto.createHash("sha256").update([...ids].sort().join("|")).digest("hex").slice(0, 12);
}
