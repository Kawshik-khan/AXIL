/**
 * CommerceOS Phase 6: Metric Registry Service
 * Central authoritative registry of canonical business metrics, formulas, and units.
 */

import { db } from "@/infrastructure/db";
import { MetricDefinition, MetricCategory } from "@/types/intelligence";

export class MetricRegistryService {
  /**
   * Retrieves all active metric definitions
   */
  public getDefinitions(category?: MetricCategory): MetricDefinition[] {
    const all = db.getMetricDefinitions();
    if (category) {
      return all.filter((m) => m.category === category && m.status === "ACTIVE");
    }
    return all.filter((m) => m.status === "ACTIVE");
  }

  /**
   * Retrieves a specific metric definition by key
   */
  public getDefinition(key: string): MetricDefinition | undefined {
    return db.getMetricDefinition(key);
  }

  /**
   * Asserts whether a given metric key is registered and valid
   */
  public assertValidMetric(key: string): MetricDefinition {
    const def = this.getDefinition(key);
    if (!def) {
      throw new Error(`Metric '${key}' is not defined in the authoritative Metric Registry.`);
    }
    return def;
  }

  /**
   * Returns human-readable formula and explanation for explainability
   */
  public getMetricExplanation(key: string): {
    key: string;
    name: string;
    formula: string;
    description: string;
    unit: string;
    currency_sensitive: boolean;
  } {
    const def = this.assertValidMetric(key);
    return {
      key: def.key,
      name: def.name,
      formula: def.formula,
      description: def.description,
      unit: def.unit,
      currency_sensitive: def.currency_sensitive,
    };
  }
}

export const metricRegistryService = new MetricRegistryService();
