/**
 * CommerceOS Phase 9: Enterprise Benchmarking Service
 * Store vs Store, Brand vs Brand, internal and external industry benchmarks with statistical validity disclosures.
 */

import { db } from "@/infrastructure/db";
import {
  EnterpriseBenchmark,
  BenchmarkComparisonItem,
  EnterpriseUserRecord,
} from "@/types/enterprise";
import { enterpriseDataAccessService } from "./enterprise-data-access.service";

/**
 * Orders carry no store or brand, so nothing can be compared per entity yet. These used to rank stores by invented
 * values (revenue split 45/35/25%, AOV 2400 + 350 per position, SLA 98 - 2.5 per position, brands 500k - 120k per
 * position) (FX-30). They now list the entities in the caller's real scope (N11) with no values.
 */
const NOT_ATTRIBUTED =
  "Not measured: orders aren't attributed to stores or brands yet, so there is no per-entity data to compare.";

export class EnterpriseBenchmarkingService {
  public generateStoreBenchmark(
    orgId: string,
    metricKey: string,
    caller: EnterpriseUserRecord,
    _tenantId: string,
    opts: { persist?: boolean } = {}
  ): EnterpriseBenchmark {
    const stores = enterpriseDataAccessService.getAuthorizedStores(caller);
    const benchmark = this.unmeasured(orgId, metricKey, "STORE", stores, {
      id: `bench_store_${metricKey}_${Date.now()}`,
      title: `Store Benchmark: ${metricKey.replace(/_/g, " ").toUpperCase()}`,
      benchmark_type: "STORE_VS_STORE",
    });
    return opts.persist === false ? benchmark : db.createEnterpriseBenchmark(benchmark); // GETs don't store (FX-21)
  }

  /**
   * Brand vs brand. Same limitation as stores.
   */
  public generateBrandBenchmark(
    orgId: string,
    metricKey: string,
    caller: EnterpriseUserRecord,
    opts: { persist?: boolean } = {}
  ): EnterpriseBenchmark {
    const brands = enterpriseDataAccessService.getAuthorizedBrands(caller);
    const benchmark = this.unmeasured(orgId, metricKey, "BRAND", brands, {
      id: `bench_brand_${metricKey}_${Date.now()}`,
      title: `Brand Benchmark: ${metricKey.replace(/_/g, " ").toUpperCase()}`,
      benchmark_type: "BRAND_VS_BRAND",
    });
    return opts.persist === false ? benchmark : db.createEnterpriseBenchmark(benchmark); // GETs don't store (FX-21)
  }

  private unmeasured(
    orgId: string,
    metricKey: string,
    entityType: "STORE" | "BRAND",
    entities: Array<{ id: string; name: string }>,
    head: Pick<EnterpriseBenchmark, "id" | "title" | "benchmark_type">
  ): EnterpriseBenchmark {
    const items: BenchmarkComparisonItem[] = entities.map((e) => ({
      entity_id: e.id,
      entity_name: e.name,
      entity_type: entityType,
      metric_key: metricKey,
      value: null,
      rank: null,
      percentile: null,
      variance_from_average_pct: null,
    }));
    return {
      ...head,
      organization_id: orgId,
      metric_key: metricKey,
      population_count: items.length,
      time_period: "Not measured",
      items,
      cohort_average: null,
      cohort_median: null,
      data_status: "NOT_MEASURED",
      limitations_disclosure: NOT_ATTRIBUTED,
      is_statistically_significant: false,
      generated_at: new Date().toISOString(),
    };
  }
}

export const enterpriseBenchmarkingService = new EnterpriseBenchmarkingService();
