"use client";

import React from "react";
import {
  Basket,
  Branches,
  Cabinet,
  Drawer,
  Hub,
  Padlock,
  Plot,
  Plug,
  Query,
  Settle,
  Sieve,
  Terminal,
  type HairlineProps,
} from "@lucasmarkes/hairline/react";
import styles from "./HairlineFigure.module.css";

/**
 * The state a figure illustrates. Hairline figures are decoration only: they never carry numbers or stand in for
 * a chart (super-admin console plan R7), so the props take a meaning, not data, and the figure's caption is unused.
 */
export type FigureKind =
  | "all-clear"
  | "empty-list"
  | "no-data"
  | "no-results"
  | "filtered-out"
  | "queue-empty"
  | "disconnected"
  | "network-empty"
  | "releases-empty"
  | "infrastructure-empty"
  | "log-empty"
  | "sign-in";

type FigureComponent = React.ForwardRefExoticComponent<HairlineProps & React.RefAttributes<HTMLDivElement>>;

const FIGURES: Record<FigureKind, FigureComponent> = {
  "all-clear": Settle,
  "empty-list": Drawer,
  "no-data": Plot,
  "no-results": Query,
  "filtered-out": Sieve,
  "queue-empty": Basket,
  disconnected: Plug,
  "network-empty": Hub,
  "releases-empty": Branches,
  "infrastructure-empty": Cabinet,
  "log-empty": Terminal,
  "sign-in": Padlock,
};

/** How strongly every figure answers the pointer: noticeable, never busy. */
const INTENSITY = 0.4;

export interface HairlineFigureProps {
  kind: FigureKind;
  /** The surface the figure sits on; the figure's plate must match it exactly. */
  surface?: "light" | "dark";
  size?: "sm" | "md";
  className?: string;
}

export const HairlineFigure: React.FC<HairlineFigureProps> = ({ kind, surface = "light", size = "sm", className = "" }) => {
  const Figure = FIGURES[kind];
  return (
    <div className={`${styles.frame} ${styles[size]} ${styles[surface]} ${className}`} aria-hidden="true">
      <Figure theme={surface} intensity={INTENSITY} play={kind === "sign-in"} aria-hidden="true" />
    </div>
  );
};
