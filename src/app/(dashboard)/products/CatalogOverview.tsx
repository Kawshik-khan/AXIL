"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PRODUCT_STATUSES, STATUS_LABELS, STATUS_NOTES, type ListedStatus, type StockRow } from "./product-display";
import styles from "./products.module.css";

/** One total per tile status, plus `all`: every product, including ones imported as out of stock or discontinued. */
export type StatusCounts = Record<ListedStatus, number> & { all: number };

const show = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString());

/** The lime "All products" tile and one tile per status; picking a tile filters the list. */
export function StatusTiles({
  counts,
  active,
  onPick,
}: {
  counts: StatusCounts | null;
  active: ListedStatus | null;
  onPick: (status: ListedStatus | null) => void;
}) {
  const all = counts?.all ?? null;
  const other = counts ? counts.all - PRODUCT_STATUSES.reduce((sum, s) => sum + counts[s], 0) : 0;
  const note = counts
    ? `${counts.ACTIVE.toLocaleString()} on sale now${other > 0 ? ` · ${other.toLocaleString()} imported as out of stock or discontinued` : ""}`
    : "Counting…";
  return (
    <section className={styles.tiles} aria-label="Filter by status">
      <button type="button" className={`${styles.tile} ${styles.tileLead}`} aria-pressed={active === null} onClick={() => onPick(null)}>
        <span className={styles.tileLabel}>All products</span>
        <span>
          <span className={styles.tileValue}>{show(all)}</span>
          <span className={styles.tileNote}>{note}</span>
        </span>
      </button>
      {PRODUCT_STATUSES.map((status) => (
        <button key={status} type="button" className={styles.tile} aria-pressed={active === status} onClick={() => onPick(status)}>
          <span className={styles.tileLabel}>{STATUS_LABELS[status]}</span>
          <span>
            <span className={styles.tileValue}>{show(counts?.[status])}</span>
            <span className={styles.tileNote}>{STATUS_NOTES[status]}</span>
          </span>
        </button>
      ))}
    </section>
  );
}

const RESTOCK_SHOWN = 5;

/**
 * The lilac panel: variants at or under their reorder point, from live inventory.
 * `restock` is null while loading, or when stock cannot be read (then `note` says why).
 */
export function RestockPanel({ restock, note }: { restock: StockRow[] | null; note?: string }) {
  const out = restock?.filter((r) => r.quantity_available <= 0).length ?? 0;
  const low = restock ? restock.length - out : 0;

  return (
    <aside className={styles.attention} aria-label="Stock that needs attention">
      <div className={styles.attentionHead}>
        <span className={styles.attentionTitle}>Needs restocking</span>
        <Link href="/inventory" className={styles.attentionLink}>
          Inventory <ArrowRight size={14} />
        </Link>
      </div>

      {note ? (
        <p className={styles.attentionNote}>{note}</p>
      ) : restock === null ? (
        <p className={styles.attentionNote}>Checking stock…</p>
      ) : restock.length === 0 ? (
        <p className={styles.attentionNote}>Every tracked variant is above its reorder point.</p>
      ) : (
        <>
          <div className={styles.attentionStats}>
            <span>
              <span className={styles.attentionValue}>{out}</span> out of stock
            </span>
            <span>
              <span className={styles.attentionValue}>{low}</span> running low
            </span>
          </div>
          <ul className={styles.attentionList}>
            {restock.slice(0, RESTOCK_SHOWN).map((row) => (
              <li key={row.product_variant_id} className={styles.attentionRow}>
                <span className={styles.attentionName}>
                  {row.product_name}
                  {row.variant_title && row.variant_title !== "Standard" && row.variant_title !== "Default" ? (
                    <span className={styles.attentionVariant}> · {row.variant_title}</span>
                  ) : null}
                </span>
                <span className={row.quantity_available <= 0 ? `${styles.attentionQty} ${styles.attentionOut}` : styles.attentionQty}>
                  {row.quantity_available <= 0 ? "Out" : `${row.quantity_available} left`}
                </span>
              </li>
            ))}
          </ul>
          {restock.length > RESTOCK_SHOWN && (
            <p className={styles.attentionNote}>and {restock.length - RESTOCK_SHOWN} more in Inventory</p>
          )}
        </>
      )}
    </aside>
  );
}
