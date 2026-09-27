"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Sliders, Play, RotateCcw, TrendingUp, Sparkles, CheckCircle2, AlertCircle } from "lucide-react";
import styles from "../intelligence.module.css";
import { LoadingSkeleton, ErrorState } from "@/components/ui/States/States";

export default function SimulationSandboxPage() {
  const [priceChange, setPriceChange] = useState<number>(0);
  const [discountChange, setDiscountChange] = useState<number>(0);
  const [inventoryAlloc, setInventoryAlloc] = useState<number>(0);
  const [shippingChange, setShippingChange] = useState<number>(0);

  const [simulation, setSimulation] = useState<any>(null);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSimulation = async () => {
    setSimulating(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/intelligence/simulations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario_name: "Interactive What-If Simulation",
          scenario_type: "CUSTOM",
          inputs: {
            price_change_pct: priceChange,
            discount_rate_change_pct: discountChange,
            inventory_allocation_units: inventoryAlloc,
            shipping_fee_change_bdt: shippingChange,
          },
        }),
      });
      if (!res.ok) throw new Error("Simulation failed");
      const json = await res.json();
      setSimulation(json.data?.simulation);
    } catch (err: any) {
      setError(err.message || "Failed to execute simulation");
    } finally {
      setSimulating(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      runSimulation();
    }, 250);
    return () => clearTimeout(timer);
  }, [priceChange, discountChange, inventoryAlloc, shippingChange]);

  const handleReset = () => {
    setPriceChange(0);
    setDiscountChange(0);
    setInventoryAlloc(0);
    setShippingChange(0);
  };

  const baseline = simulation?.baseline_metrics || {};
  const projected = simulation?.projected_metrics || {};
  const deltas = simulation?.deltas || {};
  const isNetPositive = (deltas.revenue_delta_bdt || 0) >= 0;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.headerTitle}>
            <Sliders size={24} color="#C7F900" /> What-If Decision Sandbox
          </h1>
          <p className={styles.headerSubtitle}>
            Simulate price elasticity, promotional discount impacts, and inventory buffers in an isolated sandbox with zero database mutations.
          </p>
        </div>
        <button className={styles.secondaryBtn} onClick={handleReset}>
          <RotateCcw size={14} style={{ marginRight: 6 }} /> Reset Defaults
        </button>
      </div>

      <div className={styles.navTabs}>
        <Link href="/intelligence" className={styles.navTab}>Executive Overview</Link>
        <Link href="/intelligence/insights" className={styles.navTab}>Insights & Anomalies</Link>
        <Link href="/intelligence/forecasts" className={styles.navTab}>Demand Forecasts</Link>
        <Link href="/intelligence/recommendations" className={styles.navTab}>Recommendations</Link>
        <Link href="/intelligence/simulation" className={`${styles.navTab} ${styles.navTabActive}`}>What-If Sandbox</Link>
        <Link href="/intelligence/analytics" className={styles.navTab}>AI Analytics Explorer</Link>
      </div>

      <div className={styles.bentoGrid}>
        {/* Controls Column */}
        <div className={`${styles.bentoCard} ${styles.col5}`}>
          <div className={styles.cardTitle}>
            <span>🎛️ Scenario Levers</span>
            <span className={styles.badgeNeutral}>Zero-Mutation</span>
          </div>

          <div className={styles.simInputGroup}>
            <div className={styles.simLabel}>
              <span>Unit Price Adjustment:</span>
              <strong style={{ color: "#C7F900" }}>{priceChange > 0 ? `+${priceChange}%` : `${priceChange}%`}</strong>
            </div>
            <input
              type="range"
              min={-30}
              max={30}
              step={1}
              value={priceChange}
              onChange={(e) => setPriceChange(parseInt(e.target.value, 10))}
              className={styles.simSlider}
            />
          </div>

          <div className={styles.simInputGroup}>
            <div className={styles.simLabel}>
              <span>Promotional Discount Rate:</span>
              <strong style={{ color: "#C7F900" }}>{discountChange > 0 ? `+${discountChange}%` : `${discountChange}%`}</strong>
            </div>
            <input
              type="range"
              min={-20}
              max={30}
              step={1}
              value={discountChange}
              onChange={(e) => setDiscountChange(parseInt(e.target.value, 10))}
              className={styles.simSlider}
            />
          </div>

          <div className={styles.simInputGroup}>
            <div className={styles.simLabel}>
              <span>Extra Inventory Reorder:</span>
              <strong style={{ color: "#C7F900" }}>+{inventoryAlloc} units</strong>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              step={10}
              value={inventoryAlloc}
              onChange={(e) => setInventoryAlloc(parseInt(e.target.value, 10))}
              className={styles.simSlider}
            />
          </div>

          <div className={styles.simInputGroup}>
            <div className={styles.simLabel}>
              <span>Delivery Fee Adjustment (BDT):</span>
              <strong style={{ color: "#C7F900" }}>{shippingChange > 0 ? `+৳${shippingChange}` : `৳${shippingChange}`}</strong>
            </div>
            <input
              type="range"
              min={-60}
              max={60}
              step={10}
              value={shippingChange}
              onChange={(e) => setShippingChange(parseInt(e.target.value, 10))}
              className={styles.simSlider}
            />
          </div>
        </div>

        {/* Comparison Output Column */}
        <div className={`${styles.bentoCard} ${styles.col7}`}>
          <div className={styles.cardTitle}>
            <span>📊 Side-by-Side Impact Projections</span>
            {isNetPositive ? (
              <span className={styles.badgeLime}>Net Favorable</span>
            ) : (
              <span className={styles.badgeRed}>Net Unfavorable</span>
            )}
          </div>

          {error ? (
            <ErrorState title="Simulation Error" message={error} />
          ) : (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Current Baseline</th>
                    <th>Simulated Projection</th>
                    <th>Expected Delta</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Order Volume</td>
                    <td>{baseline.orders_count || 0}</td>
                    <td><strong style={{ color: "#fff" }}>{projected.orders_count || 0}</strong></td>
                    <td style={{ color: (deltas.orders_delta || 0) >= 0 ? "#C7F900" : "#ff6b6b" }}>
                      {(deltas.orders_delta || 0) >= 0 ? `+${deltas.orders_delta}` : deltas.orders_delta} orders
                    </td>
                  </tr>
                  <tr>
                    <td>Gross Revenue</td>
                    <td>৳{(baseline.revenue_bdt || 0).toLocaleString()}</td>
                    <td><strong style={{ color: "#fff" }}>৳{(projected.revenue_bdt || 0).toLocaleString()}</strong></td>
                    <td style={{ color: isNetPositive ? "#C7F900" : "#ff6b6b" }}>
                      {isNetPositive ? `+৳${(deltas.revenue_delta_bdt || 0).toLocaleString()}` : `-৳${Math.abs(deltas.revenue_delta_bdt || 0).toLocaleString()}`}
                    </td>
                  </tr>
                  <tr>
                    <td>Average Order Value</td>
                    <td>৳{Math.round(baseline.aov_bdt || 0)}</td>
                    <td><strong style={{ color: "#fff" }}>৳{Math.round(projected.aov_bdt || 0)}</strong></td>
                    <td style={{ color: (projected.aov_bdt || 0) >= (baseline.aov_bdt || 0) ? "#C7F900" : "#ff6b6b" }}>
                      {Math.round((projected.aov_bdt || 0) - (baseline.aov_bdt || 0)) >= 0 ? "+" : ""}
                      ৳{Math.round((projected.aov_bdt || 0) - (baseline.aov_bdt || 0))}
                    </td>
                  </tr>
                  <tr>
                    <td>Gross Margin (Est. 35%)</td>
                    <td>৳{Math.round(baseline.gross_margin_bdt || 0).toLocaleString()}</td>
                    <td><strong style={{ color: "#fff" }}>৳{Math.round(projected.gross_margin_bdt || 0).toLocaleString()}</strong></td>
                    <td style={{ color: (deltas.margin_delta_bdt || 0) >= 0 ? "#C7F900" : "#ff6b6b" }}>
                      {(deltas.margin_delta_bdt || 0) >= 0 ? `+৳${Math.round(deltas.margin_delta_bdt || 0).toLocaleString()}` : `-৳${Math.round(Math.abs(deltas.margin_delta_bdt || 0)).toLocaleString()}`}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 16, padding: 12, background: "rgba(255, 255, 255, 0.03)", borderRadius: 10 }}>
            <div style={{ fontSize: 12, color: "#8c8f96" }}>
              <strong style={{ color: "#ededed" }}>Elasticity Model:</strong> Standard retail price elasticity of demand (-1.2). For every +1% net price increase, projected demand volume decreases by 1.2%.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
