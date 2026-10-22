import React from "react";

export interface RevenueSparklineProps {
  values: number[];
  label: string;
}

const WIDTH = 160;
const HEIGHT = 48;
const PAD = 3;

/** Dependency-free area sparkline. Draws nothing without at least two points; a flat zero series is a flat line. */
export const RevenueSparkline: React.FC<RevenueSparklineProps> = ({ values, label }) => {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const stepX = (WIDTH - PAD * 2) / (values.length - 1);
  const points = values.map((v, i) => [PAD + i * stepX, HEIGHT - PAD - (v / max) * (HEIGHT - PAD * 2)] as const);
  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${points[points.length - 1][0].toFixed(1)},${HEIGHT} L${points[0][0].toFixed(1)},${HEIGHT} Z`;

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT} role="img" aria-label={label} preserveAspectRatio="none">
      <path d={area} fill="var(--color-lime-glow)" />
      <path d={line} fill="none" stroke="var(--color-lime-primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};
