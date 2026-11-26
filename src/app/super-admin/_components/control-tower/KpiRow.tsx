import React from "react";
import { BentoCard } from "@/components/bento/BentoCard";
import type { AttentionItem } from "@/domains/platform/services/platform-attention.service";
import type { PlatformOverviewMetrics } from "@/domains/platform/services/platform-analytics.service";
import { formatCount, formatPercent, humanize, isPresent, NO_DATA } from "../../_lib/format";
import { countBySeverity, SEVERITIES } from "./control-tower-view";
import styles from "./control-tower.module.css";

interface TileProps {
  label: string;
  value: string;
  /** "BDT", printed small before the figure. */
  unit?: string;
  chip?: string;
  lead?: boolean;
}

const Tile: React.FC<TileProps> = ({ label, value, unit, chip, lead = false }) => {
  const missing = value === NO_DATA;
  return (
    <BentoCard span={3} className={`${styles.tile} ${lead ? styles.tileLead : ""}`}>
      <h2 className={styles.tileLabel}>{label}</h2>
      <div className={styles.tileRow}>
        <div className={missing ? styles.tileNone : styles.tileValue}>
          {!missing && unit && <small>{unit}</small>}
          {value}
        </div>
        {chip && <span className={styles.tileChip}>{chip}</span>}
      </div>
    </BentoCard>
  );
};

/** The four headline figures: what needs attention (the lime lead), revenue, GMV and AI spend. */
export const KpiRow: React.FC<{ overview: PlatformOverviewMetrics; items: readonly AttentionItem[] | null }> = ({ overview, items }) => {
  const { financials: f, commerce_velocity: v, ai_fleet: ai } = overview;
  const counts = items ? countBySeverity(items) : null;
  const worst = counts ? SEVERITIES.find((s) => counts[s] > 0) : undefined;
  return (
    <>
      <Tile
        lead
        label="Needs attention"
        value={items ? `${formatCount(items.length)} ${items.length === 1 ? "item" : "items"}` : NO_DATA}
        chip={counts && worst ? `${formatCount(counts[worst])} ${humanize(worst).toLowerCase()}` : items ? "All clear" : undefined}
      />
      <Tile
        label="Recurring revenue"
        unit={f.currency}
        value={f.active_subscriptions_count > 0 ? formatCount(f.mrr_bdt) : NO_DATA}
        chip={`${formatCount(f.active_subscriptions_count)} paying`}
      />
      <Tile
        label="GMV, all workspaces"
        unit="BDT"
        value={v.total_orders_count > 0 ? formatCount(v.total_gmv_bdt) : NO_DATA}
        chip={isPresent(v.cod_percentage) ? `${formatPercent(v.cod_percentage, 0)} COD` : `${formatCount(v.total_orders_count)} orders`}
      />
      <Tile
        label="AI spend, estimated"
        unit="BDT"
        value={ai.total_tokens > 0 ? formatCount(Math.round(ai.estimated_cost_bdt)) : NO_DATA}
        chip={isPresent(ai.autonomous_resolution_rate) ? `${formatPercent(ai.autonomous_resolution_rate)} done` : undefined}
      />
    </>
  );
};
