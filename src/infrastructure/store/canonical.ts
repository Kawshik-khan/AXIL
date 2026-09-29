/**
 * Order-independent JSON for comparing records (backfill verification and the Postgres test mode). jsonb doesn't keep
 * key order, so two equal records can serialize differently; this sorts keys at every level.
 */
import { serializeRecord } from "./pg-store";
import { recordId } from "./store-schema";

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** The record as Postgres stores it (after the same NUL / lone-surrogate cleaning), with sorted keys. */
export function canonicalRecord(record: unknown): string {
  return JSON.stringify(sortKeys(JSON.parse(serializeRecord(record).json)));
}

export interface CollectionDiff {
  collection: string;
  expected: number;
  actual: number;
  missing: string[];
  unexpected: string[];
  different: string[];
}

/**
 * Compares two stores record by record (by id, ignoring order). Only array collections are compared; a collection
 * missing on one side counts as empty there.
 */
export function diffStores(expected: Record<string, unknown>, actual: Record<string, unknown>, sample = 5): CollectionDiff[] {
  const out: CollectionDiff[] = [];
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const collection of [...keys].sort()) {
    const e = expected[collection];
    const a = actual[collection];
    if (!Array.isArray(e) && !Array.isArray(a)) continue;
    const index = (list: unknown) => {
      const map = new Map<string, string>();
      if (Array.isArray(list)) {
        for (const row of list) {
          const id = row && typeof row === "object" && !Array.isArray(row) ? recordId(collection, row as Record<string, unknown>) : null;
          if (id !== null && !map.has(id)) map.set(id, canonicalRecord(row));
        }
      }
      return map;
    };
    const em = index(e);
    const am = index(a);
    const missing: string[] = [];
    const different: string[] = [];
    for (const [id, json] of em) {
      const other = am.get(id);
      if (other === undefined) missing.push(id);
      else if (other !== json) different.push(id);
    }
    const unexpected = [...am.keys()].filter((id) => !em.has(id));
    if (missing.length || unexpected.length || different.length) {
      out.push({
        collection,
        expected: em.size,
        actual: am.size,
        missing: missing.slice(0, sample),
        unexpected: unexpected.slice(0, sample),
        different: different.slice(0, sample),
      });
    }
  }
  return out;
}

export function countRecords(store: Record<string, unknown>): { collections: number; rows: number } {
  let collections = 0;
  let rows = 0;
  for (const value of Object.values(store)) {
    if (Array.isArray(value)) {
      collections++;
      rows += value.length;
    }
  }
  return { collections, rows };
}
