/**
 * Removes the made-up measurements the demo seed used to write (FX-30 follow-up). New stores no longer get them; this
 * cleans stores created before. Records are matched by their seed ids (or exact seed values), so anything a user
 * created or changed is left alone.
 *
 * Pure over the data object: `apply: false` only reports.
 */
import type { CourierPerformance } from "@/types/operations";
import type { ModelRegistryEntry } from "@/types/intelligence";
import type { BusinessObjective, SLODefinition } from "@/types/autonomous";

export interface DemoTelemetryData {
  provider_health: Array<{ id: string }>;
  platform_health_records: Array<{ id: string }>;
  slo_definitions: SLODefinition[];
  courier_performances: CourierPerformance[];
  model_registry: ModelRegistryEntry[];
  business_objectives: BusinessObjective[];
}

export interface DemoTelemetryReport {
  provider_health_removed: number;
  platform_health_removed: number;
  slos_removed: number;
  courier_performances_removed: number;
  model_metrics_cleared: number;
  objectives_reset: number;
}

const SEEDED_PROVIDER_HEALTH = new Set(["ph_bkash", "ph_nagad", "ph_steadfast", "ph_pathao"]);
const SEEDED_PLATFORM_HEALTH = new Set(["ph_baseline"]);
const SEEDED_SLOS = new Set(["slo_api_availability", "slo_decision_latency"]);
const SEEDED_MODELS = new Set(["mod_demand_forecaster_v1", "mod_sales_forecaster_v1", "mod_rfm_segmenter_v1", "mod_anomaly_detector_v1"]);
/** courier, rating, active shipments: the three seeded rows */
const SEEDED_COURIERS = new Set(["STEADFAST|92|42", "PATHAO|89|18", "REDX|84|9"]);
/** objective id → the progress the seed gave it; reset only while it still has that value */
const SEEDED_OBJECTIVES: Record<string, number> = { obj_increase_revenue: 42, obj_reduce_stockouts: 28, obj_delivery_success: 55 };

export function cleanDemoTelemetry(data: DemoTelemetryData, opts: { apply: boolean }): DemoTelemetryReport {
  const keepProvider = data.provider_health.filter((p) => !SEEDED_PROVIDER_HEALTH.has(p.id));
  const keepPlatform = data.platform_health_records.filter((p) => !SEEDED_PLATFORM_HEALTH.has(p.id));
  const keepSlos = data.slo_definitions.filter((s) => !SEEDED_SLOS.has(s.id));
  const keepCouriers = data.courier_performances.filter(
    (c) => !SEEDED_COURIERS.has(`${c.courier_provider}|${c.rating_score}|${c.active_shipments_count}`)
  );
  const models = data.model_registry.filter((m) => SEEDED_MODELS.has(m.id) && Object.keys(m.metrics ?? {}).length > 0);
  const objectives = data.business_objectives.filter(
    (o) => SEEDED_OBJECTIVES[o.id] !== undefined && o.progress_percent === SEEDED_OBJECTIVES[o.id]
  );

  const report: DemoTelemetryReport = {
    provider_health_removed: data.provider_health.length - keepProvider.length,
    platform_health_removed: data.platform_health_records.length - keepPlatform.length,
    slos_removed: data.slo_definitions.length - keepSlos.length,
    courier_performances_removed: data.courier_performances.length - keepCouriers.length,
    model_metrics_cleared: models.length,
    objectives_reset: objectives.length,
  };
  if (!opts.apply) return report;

  data.provider_health.splice(0, data.provider_health.length, ...keepProvider);
  data.platform_health_records.splice(0, data.platform_health_records.length, ...keepPlatform);
  data.slo_definitions.splice(0, data.slo_definitions.length, ...keepSlos);
  data.courier_performances.splice(0, data.courier_performances.length, ...keepCouriers);
  const now = new Date().toISOString();
  for (const m of models) {
    m.metrics = {};
    if (m.status === "DEPLOYED") m.status = "READY";
    m.updated_at = now;
  }
  for (const o of objectives) {
    o.current_value = o.baseline_value;
    o.progress_percent = 0;
    o.forecast_achievement_percent = null;
    o.budget_spent_bdt = 0;
    o.updated_at = now;
  }
  return report;
}
