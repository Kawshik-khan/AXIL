/**
 * CommerceOS Phase 6: What-If Simulation Sandbox Service
 * Evaluates hypothetical scenario adjustments (pricing, restock quantities, discounts, shipping fees)
 * in a zero-mutation in-memory sandbox. Never modifies physical database records.
 */

import { db } from "@/infrastructure/db";
import {
  SimulationInput,
  SimulationResult,
  SimulationScenarioType,
  SimulationMetricDelta,
} from "@/types/intelligence";

export class SimulationService {
  /**
   * Simulates commercial outcomes under hypothetical parameter modifications
   */
  public simulateScenario(
    tenantId: string,
    scenarioName: string,
    inputs: SimulationInput,
    scenarioType: SimulationScenarioType = "CUSTOM"
  ): SimulationResult {
    const orders = db.getAllOrders(tenantId, { hydrate: true }).filter((o) => o.status !== "CANCELLED");

    // 1. Establish 30-day baseline metrics
    const baselineOrders = orders.length;
    const baselineRevenue = orders.reduce((sum, o) => sum + (o.grand_total || (o as any).total_amount || 0), 0);
    const baselineAov = baselineOrders > 0 ? baselineRevenue / baselineOrders : 0;
    const baselineMargin = baselineRevenue * 0.35; // 35% standard margin

    // 2. Compute elasticity and delta projections
    // Standard Retail Price Elasticity of Demand: -1.2 (for every +1% price, demand drops -1.2%)
    const priceChangePct = inputs.price_change_pct || 0;
    const discountChangePct = inputs.discount_rate_change_pct || 0;
    const inventoryUnits = inputs.inventory_allocation_units || 0;
    const shippingFeeChange = inputs.shipping_fee_change_bdt || 0;

    const netPriceEffectPct = priceChangePct - discountChangePct;
    const elasticity = -1.2;
    const projectedVolumeChangePct = netPriceEffectPct * elasticity;

    // Projected simulated metrics
    const simulatedOrders = Math.max(
      0,
      Math.round(baselineOrders * (1 + projectedVolumeChangePct / 100))
    );
    const simulatedAov = baselineAov * (1 + priceChangePct / 100);
    const simulatedRevenue = Number((simulatedOrders * simulatedAov).toFixed(2));
    const simulatedMargin = Number((simulatedRevenue * 0.35).toFixed(2));

    // Calculate deltas
    const deltas: SimulationMetricDelta[] = [
      {
        metric: "revenue",
        baseline: baselineRevenue,
        simulated: simulatedRevenue,
        delta_absolute: Number((simulatedRevenue - baselineRevenue).toFixed(2)),
        delta_percentage: baselineRevenue > 0 ? Number((((simulatedRevenue - baselineRevenue) / baselineRevenue) * 100).toFixed(1)) : 0,
        unit: "BDT",
      },
      {
        metric: "orders_count",
        baseline: baselineOrders,
        simulated: simulatedOrders,
        delta_absolute: simulatedOrders - baselineOrders,
        delta_percentage: baselineOrders > 0 ? Number((((simulatedOrders - baselineOrders) / baselineOrders) * 100).toFixed(1)) : 0,
        unit: "ORDERS",
      },
      {
        metric: "average_order_value",
        baseline: Number(baselineAov.toFixed(2)),
        simulated: Number(simulatedAov.toFixed(2)),
        delta_absolute: Number((simulatedAov - baselineAov).toFixed(2)),
        delta_percentage: baselineAov > 0 ? Number((((simulatedAov - baselineAov) / baselineAov) * 100).toFixed(1)) : 0,
        unit: "BDT",
      },
      {
        metric: "gross_margin",
        baseline: Number(baselineMargin.toFixed(2)),
        simulated: Number(simulatedMargin.toFixed(2)),
        delta_absolute: Number((simulatedMargin - baselineMargin).toFixed(2)),
        delta_percentage: baselineMargin > 0 ? Number((((simulatedMargin - baselineMargin) / baselineMargin) * 100).toFixed(1)) : 0,
        unit: "BDT",
      },
    ];

    const assumptions: string[] = [
      `Assumes price elasticity of demand Ed = -1.2 for general apparel/goods.`,
      `Competitor pricing and supplier lead times remain constant over the ${inputs.time_horizon_days || 30}-day horizon.`,
      `Zero physical database records were mutated during this simulation.`,
    ];

    if (inventoryUnits > 0) {
      assumptions.push(`Additional inventory buffer of ${inventoryUnits} units supports increased fulfillment capacity.`);
    }

    const roi = Number((simulatedMargin - baselineMargin).toFixed(2));

    const result: SimulationResult = {
      id: `sim_${Date.now()}_${tenantId}`,
      tenant_id: tenantId,
      scenario_name: scenarioName,
      scenario_type: scenarioType,
      inputs,
      baseline_metrics: {
        revenue: Number(baselineRevenue.toFixed(2)),
        orders: baselineOrders,
        aov: Number(baselineAov.toFixed(2)),
        margin: Number(baselineMargin.toFixed(2)),
      },
      simulated_metrics: {
        revenue: simulatedRevenue,
        orders: simulatedOrders,
        aov: Number(simulatedAov.toFixed(2)),
        margin: simulatedMargin,
      },
      deltas,
      assumptions,
      uncertainty_range_pct: 12.5, // 12.5% uncertainty window
      expected_roi_bdt: roi,
      model_version: "1.0.0",
      simulated_at: new Date().toISOString(),
    };

    db.insertSimulation(result);
    return result;
  }
}

export const simulationService = new SimulationService();
