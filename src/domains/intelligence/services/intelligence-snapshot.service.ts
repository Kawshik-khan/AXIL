/**
 * Intelligence snapshots (FIX_IMPLEMENTATION_PLAN FX-21, audit H8).
 *
 * Detectors and analyzers are pure `compute*` functions. GET requests never write: they return the stored snapshot
 * while it is younger than SNAPSHOT_MAX_AGE_MS, otherwise they compute in memory and return that. The snapshot is
 * stored only by an explicit recompute (POST /api/v1/intelligence/recompute, workflows, the intelligence agent), in
 * one batched write with deterministic ids, so recomputing never duplicates rows or undoes a user's decision.
 */

import { db } from "@/infrastructure/db";
import type { IntelligenceSnapshotCollection } from "@/types/intelligence";
import { mergeComputedRow } from "@/lib/computed-rows";

export const SNAPSHOT_MAX_AGE_MS = 15 * 60_000;

export type IntelligenceKind =
  | "customers"
  | "products"
  | "inventory"
  | "anomalies"
  | "opportunities"
  | "risks"
  | "recommendations"
  | "cohorts"
  | "data_quality"
  | "growth_insights"
  | "growth_recommendations";

interface KindSpec {
  collection: IntelligenceSnapshotCollection;
  /** Fields a user or workflow changes after detection; a recompute keeps them while unexpired and about the same entities. */
  keep?: readonly string[];
  /** Statuses during which a stored row is not touched by a recompute (someone is deciding on it). */
  freeze?: readonly string[];
  /** Per-entity snapshots: rows the recompute no longer produces are dropped. Event-like kinds keep history. */
  replace?: boolean;
}

const KINDS: Record<IntelligenceKind, KindSpec> = {
  customers: { collection: "customer_intelligence", replace: true },
  products: { collection: "product_performance", replace: true },
  inventory: { collection: "inventory_intelligence", replace: true },
  cohorts: { collection: "cohort_records", replace: true },
  anomalies: { collection: "anomalies" },
  risks: { collection: "risks" },
  data_quality: { collection: "data_quality_reports" },
  opportunities: { collection: "opportunities", keep: ["status"] },
  recommendations: {
    collection: "recommendations",
    keep: ["status", "reviewed_by", "reviewed_at", "dispatched_workflow_id", "rejection_reason", "updated_at"],
    freeze: ["REVIEWING"],
  },
  growth_insights: { collection: "growth_insights", keep: ["status"] },
  growth_recommendations: { collection: "growth_recommendations", keep: ["status"] },
};

export interface SnapshotMeta {
  kind: IntelligenceKind;
  /** SNAPSHOT: the stored recompute. LIVE: computed for this request and not stored. */
  source: "SNAPSHOT" | "LIVE";
  computed_at: string;
  max_age_seconds: number;
}

type Row = { id: string; tenant_id: string };

export class IntelligenceSnapshotService {
  /**
   * Read path for GET handlers. Never writes. While the last recompute is fresh, returns exactly the rows it produced
   * (with any decisions made since). Otherwise computes now; LIVE rows carry over the `keep` fields of stored rows with
   * the same id, so a recommendation the user already rejected still shows as rejected.
   */
  public read<T extends Row>(tenantId: string, kind: IntelligenceKind, compute: () => T[]): { rows: T[]; snapshot: SnapshotMeta } {
    const spec = KINDS[kind];
    const run = db.getIntelligenceRun(tenantId, kind);
    const maxAge = SNAPSHOT_MAX_AGE_MS / 1000;
    if (run && Date.now() - Date.parse(run.computed_at) < SNAPSHOT_MAX_AGE_MS) {
      const rows = db.getComputedRows<T>(spec.collection, tenantId, run.row_ids ?? []);
      return { rows, snapshot: { kind, source: "SNAPSHOT", computed_at: run.computed_at, max_age_seconds: maxAge } };
    }
    const live = compute();
    const rows = spec.keep || spec.freeze ? this.overlay(live, db.getComputedRows<T>(spec.collection, tenantId, live.map((r) => r.id)), spec) : live;
    return { rows, snapshot: { kind, source: "LIVE", computed_at: new Date().toISOString(), max_age_seconds: maxAge } };
  }

  /** Write path: stores one recomputed snapshot of a kind in a single batched write. */
  public persist<T extends Row>(tenantId: string, kind: IntelligenceKind, rows: T[]): T[] {
    const spec = KINDS[kind];
    return db.upsertComputedRows(spec.collection, tenantId, kind, rows, { keep: spec.keep, freeze: spec.freeze, replace: spec.replace });
  }

  /** Same merge rule as a stored recompute, applied in memory. */
  private overlay<T extends Row>(live: T[], stored: T[], spec: KindSpec): T[] {
    const byId = new Map(stored.map((r) => [r.id, r as unknown as Record<string, unknown>]));
    return live.map((row) => {
      const existing = byId.get(row.id);
      return existing ? (mergeComputedRow(existing, row as unknown as Record<string, unknown>, spec) as unknown as T) : row;
    });
  }
}

export const intelligenceSnapshots = new IntelligenceSnapshotService();
