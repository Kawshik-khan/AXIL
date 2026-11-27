"use client";

import React from "react";
import {
  CUSTOMER_SEGMENTS,
  HIGH_VALUE_LIFETIME_SPEND_BDT,
  REPEAT_MIN_ORDERS,
  type CustomerSegment,
  type SegmentCounts,
} from "@/lib/customer-segments";
import { SEGMENT_LABELS, formatTaka } from "./customer-display";
import styles from "./customers.module.css";

/** What each segment means, from the same constants the list query uses. */
const SEGMENT_NOTES: Record<CustomerSegment, string> = {
  NEW: "No orders yet",
  ONE_TIME: "One order so far",
  REPEAT: `${REPEAT_MIN_ORDERS}+ orders`,
  HIGH_VALUE: `${formatTaka(HIGH_VALUE_LIFETIME_SPEND_BDT)}+ lifetime spend`,
};

interface SegmentTilesProps {
  counts: SegmentCounts | null;
  active: CustomerSegment | null;
  onPick: (segment: CustomerSegment | null) => void;
}

/** The lime "All customers" tile and one tile per segment; picking a tile filters the list. */
export function SegmentTiles({ counts, active, onPick }: SegmentTilesProps) {
  const all = counts ? CUSTOMER_SEGMENTS.reduce((sum, s) => sum + counts[s], 0) : null;
  const ordered = counts && all !== null ? all - counts.NEW : null;
  const show = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString());

  return (
    <section className={styles.tiles} aria-label="Filter by segment">
      <button type="button" className={`${styles.tile} ${styles.tileLead}`} aria-pressed={active === null} onClick={() => onPick(null)}>
        <span className={styles.tileLabel}>All customers</span>
        <span>
          <span className={styles.tileValue}>{show(all)}</span>
          <span className={styles.tileNote}>{ordered === null ? "Counting…" : `${ordered.toLocaleString()} have placed an order`}</span>
        </span>
      </button>
      {CUSTOMER_SEGMENTS.map((segment) => (
        <button key={segment} type="button" className={styles.tile} aria-pressed={active === segment} onClick={() => onPick(segment)}>
          <span className={styles.tileLabel}>{SEGMENT_LABELS[segment]}</span>
          <span>
            <span className={styles.tileValue}>{show(counts?.[segment])}</span>
            <span className={styles.tileNote}>{SEGMENT_NOTES[segment]}</span>
          </span>
        </button>
      ))}
    </section>
  );
}
