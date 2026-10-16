"use client";

import React from "react";
import styles from "./Slider.module.css";

export interface SliderPreset {
  label: string;
  value: number;
}

export interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  formatValue?: (value: number) => string;
  presets?: SliderPreset[];
  icon?: React.ReactNode;
  hint?: string;
  className?: string;
  disabled?: boolean;
}

export const Slider: React.FC<SliderProps> = ({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = "",
  formatValue,
  presets,
  icon,
  className = "",
  disabled = false,
}) => {
  // Compute percentage positions for CSS gradient fill
  const range = max - min;
  const valPercent = range > 0 ? Math.min(100, Math.max(0, ((value - min) / range) * 100)) : 0;

  let trackBg = "rgba(30, 32, 30, 0.08)";
  if (min < 0 && max > 0) {
    const zeroPercent = ((0 - min) / range) * 100;
    if (value > 0) {
      trackBg = `linear-gradient(to right, rgba(30, 32, 30, 0.08) 0%, rgba(30, 32, 30, 0.08) ${zeroPercent}%, #C7F900 ${zeroPercent}%, #C7F900 ${valPercent}%, rgba(30, 32, 30, 0.08) ${valPercent}%, rgba(30, 32, 30, 0.08) 100%)`;
    } else if (value < 0) {
      trackBg = `linear-gradient(to right, rgba(30, 32, 30, 0.08) 0%, rgba(30, 32, 30, 0.08) ${valPercent}%, #F3B63F ${valPercent}%, #F3B63F ${zeroPercent}%, rgba(30, 32, 30, 0.08) ${zeroPercent}%, rgba(30, 32, 30, 0.08) 100%)`;
    } else {
      trackBg = `linear-gradient(to right, rgba(30, 32, 30, 0.08) 0%, rgba(30, 32, 30, 0.08) 100%)`;
    }
  } else {
    trackBg = `linear-gradient(to right, #C7F900 0%, #C7F900 ${valPercent}%, rgba(30, 32, 30, 0.08) ${valPercent}%, rgba(30, 32, 30, 0.08) 100%)`;
  }

  // Value formatting
  const displayValue = formatValue
    ? formatValue(value)
    : value > 0
    ? `+${value}${unit}`
    : `${value}${unit}`;

  const badgeClass =
    value > 0
      ? styles.badgePositive
      : value < 0
      ? styles.badgeNegative
      : styles.badgeNeutral;

  return (
    <div className={`${styles.sliderWrapper} ${className}`}>
      <div className={styles.headerRow}>
        <div className={styles.labelGroup}>
          {icon && <span className={styles.iconWrap}>{icon}</span>}
          <label className={styles.label}>{label}</label>
        </div>
        <span className={`${styles.valueBadge} ${badgeClass}`}>
          {displayValue}
        </span>
      </div>

      <div className={styles.trackContainer}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className={styles.rangeInput}
          style={{ "--track-bg": trackBg } as React.CSSProperties}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
        />
      </div>

      <div className={styles.scaleRow}>
        <span>{min > 0 ? `+${min}${unit}` : `${min}${unit}`}</span>
        {min < 0 && max > 0 && <span className={styles.scaleCenter}>0 (Baseline)</span>}
        <span>+{max}{unit}</span>
      </div>

      {presets && presets.length > 0 && (
        <div className={styles.presetsRow}>
          <span className={styles.presetsLabel}>Presets:</span>
          {presets.map((preset, idx) => {
            const isActive = value === preset.value;
            return (
              <button
                key={idx}
                type="button"
                className={`${styles.presetBtn} ${isActive ? styles.presetActive : ""}`}
                onClick={() => onChange(preset.value)}
                disabled={disabled}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
