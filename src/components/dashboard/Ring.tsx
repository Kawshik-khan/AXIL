import React from "react";

export interface RingSegment {
  id: string;
  value: number;
  /** A token, e.g. var(--chart-ch-facebook) */
  color: string;
  dimmed?: boolean;
}

interface RingProps {
  segments: RingSegment[];
  size: number;
  thickness: number;
  label: string;
}

const GAP = 2;

/** A ring split by value, with a gap between segments. Zero values draw nothing. */
export const Ring: React.FC<RingProps> = ({ segments, size, thickness, label }) => {
  const centre = size / 2;
  const radius = (size - thickness) / 2;
  const length = 2 * Math.PI * radius;
  const shown = segments.filter((s) => s.value > 0);
  const total = shown.reduce((sum, s) => sum + s.value, 0);
  const gap = shown.length > 1 ? GAP : 0;
  const sumBefore = (index: number) => shown.slice(0, index).reduce((sum, s) => sum + s.value, 0);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      <g transform={`rotate(-90 ${centre} ${centre})`} fill="none" strokeWidth={thickness}>
        {total === 0 && <circle cx={centre} cy={centre} r={radius} style={{ stroke: "var(--color-track)" }} />}
        {shown.map((s, i) => (
          <circle
            key={s.id}
            cx={centre}
            cy={centre}
            r={radius}
            strokeDasharray={`${Math.max(1, (s.value / total) * length - gap)} ${length}`}
            strokeDashoffset={-(sumBefore(i) / total) * length}
            style={{ stroke: s.color, opacity: s.dimmed ? 0.25 : 1, transition: "opacity var(--transition-normal)" }}
          />
        ))}
      </g>
    </svg>
  );
};
