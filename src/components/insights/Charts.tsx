"use client";

import React, { useState } from "react";
import styles from "./insights.module.css";

// ---- Formatting -------------------------------------------------------------------------------------------------------

export function compact(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: value >= 1000 ? 1 : 2 }).format(value);
}

export function money(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined) return "—";
  const symbol = currency === "BDT" ? "৳" : currency === "USD" ? "$" : `${currency} `;
  return `${symbol}${new Intl.NumberFormat("en-US", { maximumFractionDigits: value >= 100 ? 0 : 2 }).format(value)}`;
}

export function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value}%`;
}

// ---- Stat tile --------------------------------------------------------------------------------------------------------

export interface StatTileProps {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  tone?: "default" | "good" | "bad";
  active?: boolean;
  onClick?: () => void;
}

export const StatTile: React.FC<StatTileProps> = ({ label, value, hint, icon, tone = "default", active, onClick }) => {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      className={`${styles.statTile} ${active ? styles.statTileActive : ""} ${onClick ? styles.statTileClickable : ""}`}
      onClick={onClick}
      aria-pressed={onClick ? Boolean(active) : undefined}
    >
      <span className={styles.statLabel}>
        {icon}
        {label}
      </span>
      <span className={`${styles.statValue} ${tone === "good" ? styles.toneGood : tone === "bad" ? styles.toneBad : ""}`}>{value}</span>
      {hint && <span className={styles.statHint}>{hint}</span>}
    </Tag>
  );
};

// ---- Column chart (one series over time, hover tooltip) ---------------------------------------------------------------

/** The next 1, 2 or 5 × 10ⁿ at or above `value`, so axis ticks are round numbers. */
function niceCeil(value: number): number {
  if (value <= 0) return 0;
  const step = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 5, 10]) if (m * step >= value) return m * step;
  return 10 * step;
}

export interface ColumnPoint {
  label: string;
  value: number | null;
  detail?: string;
}

export const ColumnChart: React.FC<{ points: ColumnPoint[]; format: (v: number) => string; ariaLabel: string; height?: number }> = ({
  points,
  format,
  ariaLabel,
  height = 180,
}) => {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceCeil(Math.max(0, ...points.map((p) => p.value ?? 0)));
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  const hovered = hover !== null ? points[hover] : null;

  return (
    <div className={styles.columnChart} role="img" aria-label={ariaLabel}>
      <div className={styles.columnAxis}>
        <span>{format(max)}</span>
        <span>{format(max / 2)}</span>
        <span>0</span>
      </div>
      <div className={styles.columnPlot} style={{ height }} onMouseLeave={() => setHover(null)}>
        <div className={styles.gridLines} aria-hidden>
          <span />
          <span />
          <span />
        </div>
        {points.map((p, i) => (
          <div
            key={`${p.label}-${i}`}
            className={`${styles.columnSlot} ${hover === i ? styles.columnSlotHover : ""}`}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            tabIndex={0}
            aria-label={`${p.label}: ${p.value === null ? "no data" : format(p.value)}`}
          >
            <div className={styles.column} style={{ height: max > 0 && p.value ? `${Math.max(2, (p.value / max) * 100)}%` : "0%" }} />
          </div>
        ))}
        {hovered && hover !== null && (
          <div className={styles.tooltip} style={{ left: `${((hover + 0.5) / points.length) * 100}%` }}>
            <strong>{hovered.value === null ? "No data" : format(hovered.value)}</strong>
            <span>{hovered.label}</span>
            {hovered.detail && <span>{hovered.detail}</span>}
          </div>
        )}
      </div>
      <div className={styles.columnLabels} aria-hidden>
        {points.map((p, i) => (
          <span key={`${p.label}-l-${i}`}>{i % labelEvery === 0 ? p.label : ""}</span>
        ))}
      </div>
    </div>
  );
};

// ---- Horizontal bars (ranking) ----------------------------------------------------------------------------------------

export interface HBarRow {
  key: string;
  label: string;
  value: number;
  display: string;
  sub?: string;
  tone?: "default" | "good" | "bad";
}

export const HBarChart: React.FC<{
  rows: HBarRow[];
  /** A reference value drawn as a dashed line, e.g. ROAS 1.0 = break-even. */
  reference?: { value: number; label: string };
  onSelect?: (key: string) => void;
  selected?: string | null;
}> = ({ rows, reference, onSelect, selected }) => {
  const max = Math.max(reference?.value ?? 0, ...rows.map((r) => r.value), 0);
  return (
    <div className={styles.hbars}>
      {rows.map((r) => (
        <button
          type="button"
          key={r.key}
          className={`${styles.hbarRow} ${selected === r.key ? styles.hbarSelected : ""}`}
          onClick={onSelect ? () => onSelect(r.key) : undefined}
          disabled={!onSelect}
          title={`${r.label}: ${r.display}`}
        >
          <span className={styles.hbarLabel}>
            {r.label}
            {r.sub && <small>{r.sub}</small>}
          </span>
          <span className={styles.hbarTrack}>
            <span
              className={`${styles.hbarFill} ${r.tone === "good" ? styles.fillGood : r.tone === "bad" ? styles.fillBad : ""}`}
              style={{ width: max > 0 ? `${Math.max(1, (r.value / max) * 100)}%` : "0%" }}
            />
            {reference && max > 0 && (
              <span className={styles.hbarReference} style={{ left: `${(reference.value / max) * 100}%` }} title={reference.label} />
            )}
          </span>
          <span className={styles.hbarValue}>{r.display}</span>
        </button>
      ))}
      {reference && <p className={styles.chartNote}>Dashed line: {reference.label}</p>}
    </div>
  );
};

// ---- Composition bar (parts of a whole, legend with values) -----------------------------------------------------------

const CAT_CLASSES = ["cat1", "cat2", "cat3", "cat4"] as const;

export const CompositionBar: React.FC<{ parts: Array<{ label: string; value: number | null }> }> = ({ parts }) => {
  const shown = parts.filter((p) => p.value !== null) as Array<{ label: string; value: number }>;
  const total = shown.reduce((s, p) => s + p.value, 0);
  return (
    <div>
      <div className={styles.compBar} role="img" aria-label={shown.map((p) => `${p.label} ${p.value}`).join(", ")}>
        {total > 0 &&
          shown.map((p, i) =>
            p.value > 0 ? (
              <span
                key={p.label}
                className={`${styles.compSegment} ${styles[CAT_CLASSES[parts.indexOf(p) % 4]]}`}
                style={{ flexGrow: p.value }}
                title={`${p.label}: ${p.value.toLocaleString("en-US")} (${Math.round((p.value / total) * 100)}%)`}
                data-index={i}
              />
            ) : null
          )}
      </div>
      <ul className={styles.legend}>
        {parts.map((p, i) => (
          <li key={p.label}>
            <span className={`${styles.swatch} ${styles[CAT_CLASSES[i % 4]]}`} aria-hidden />
            <span>{p.label}</span>
            <strong>{p.value === null ? "n/a" : p.value.toLocaleString("en-US")}</strong>
            {p.value !== null && total > 0 && <small>{Math.round((p.value / total) * 100)}%</small>}
          </li>
        ))}
      </ul>
    </div>
  );
};

// ---- Heatmap (weekday × time block) -----------------------------------------------------------------------------------

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const BLOCKS = ["12a", "3a", "6a", "9a", "12p", "3p", "6p", "9p"];

export const TimingHeatmap: React.FC<{ cells: Array<{ weekday: number; block: number; posts: number; avg_engagements: number }> }> = ({ cells }) => {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...cells.map((c) => c.avg_engagements));
  const byKey = new Map(cells.map((c) => [`${c.weekday}:${c.block}`, c]));
  const hovered = hover ? byKey.get(hover) : undefined;
  return (
    <div className={styles.heatmapWrap}>
      <div className={styles.heatmap} onMouseLeave={() => setHover(null)}>
        <span />
        {BLOCKS.map((b) => (
          <span key={b} className={styles.heatHead}>
            {b}
          </span>
        ))}
        {WEEKDAYS.map((day, w) => (
          <React.Fragment key={day}>
            <span className={styles.heatHead}>{day}</span>
            {BLOCKS.map((_, b) => {
              const cell = byKey.get(`${w}:${b}`);
              const level = cell ? 0.15 + 0.85 * (cell.avg_engagements / max) : 0;
              return (
                <span
                  key={`${w}:${b}`}
                  className={`${styles.heatCell} ${hover === `${w}:${b}` ? styles.heatCellHover : ""}`}
                  style={cell ? ({ "--heat": `${Math.round(level * 100)}%` } as React.CSSProperties) : undefined}
                  data-empty={cell ? undefined : "true"}
                  onMouseEnter={() => setHover(`${w}:${b}`)}
                  aria-label={cell ? `${day} ${BLOCKS[b]}: ${cell.posts} posts, ${cell.avg_engagements} avg engagements` : `${day} ${BLOCKS[b]}: no posts`}
                />
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <p className={styles.chartNote}>
        {hovered
          ? `${WEEKDAYS[hovered.weekday]} ${BLOCKS[hovered.block]}–${BLOCKS[(hovered.block + 1) % 8]}: ${hovered.posts} post${hovered.posts === 1 ? "" : "s"}, ${hovered.avg_engagements} avg engagements`
          : "Darker = more engagement per post. Dhaka time. Hover a cell for details."}
      </p>
    </div>
  );
};

// ---- Funnel -----------------------------------------------------------------------------------------------------------

export const Funnel: React.FC<{ steps: Array<{ label: string; value: number | null; source: string }> }> = ({ steps }) => {
  // Log scale: a funnel spans 970,000 impressions to a handful of orders, which a linear bar reduces to dots
  const logMax = Math.log10(Math.max(1, ...steps.map((s) => s.value ?? 0)) + 1);
  return (
    <>
    <ol className={styles.funnel}>
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        const rate = prev && s.value !== null ? Math.round((s.value / prev) * 1000) / 10 : null;
        return (
          <li key={s.label} className={styles.funnelStep}>
            <div className={styles.funnelHead}>
              <span>{s.label}</span>
              <small>{s.source}</small>
            </div>
            <div className={styles.funnelTrack}>
              <span className={styles.funnelFill} style={{ width: s.value ? `${Math.max(1.5, (Math.log10(s.value + 1) / logMax) * 100)}%` : "0%" }} />
            </div>
            <div className={styles.funnelNums}>
              <strong>{s.value === null ? "—" : s.value.toLocaleString("en-US")}</strong>
              {rate !== null && <small>{rate}% of previous</small>}
            </div>
          </li>
        );
      })}
    </ol>
    <p className={styles.chartNote}>Bar lengths use a log scale; the numbers are exact.</p>
    </>
  );
};
