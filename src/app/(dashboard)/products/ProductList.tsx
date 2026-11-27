"use client";

import React from "react";
import { Archive, ArchiveRestore, Images, Layers, Package, Pencil, Send } from "lucide-react";
import type { Product } from "@/types/commerce";
import {
  STATUS_DISPLAY,
  discountPercent,
  formatTaka,
  photoOf,
  stockLevel,
  stockOf,
  type ProductStock,
  type StockRow,
} from "./product-display";
import styles from "./products.module.css";

export type ProductView = "table" | "grid";

export interface ProductListProps {
  products: Product[];
  view: ProductView;
  categoryNames: ReadonlyMap<string, string>;
  /** Inventory rows by variant; null when stock could not be read (no permission or failed). */
  stock: Map<string, StockRow[]> | null;
  selected: ReadonlySet<string>;
  busyId: string | null;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onEdit: (product: Product) => void;
  onPhotos: (product: Product) => void;
  onArchive: (product: Product) => void;
  onSetStatus: (product: Product, status: "ACTIVE" | "DRAFT") => void;
}

const STATUS_CLASS: Record<Product["status"], string> = {
  ACTIVE: styles.statusActive,
  DRAFT: styles.statusDraft,
  ARCHIVED: styles.statusArchived,
  OUT_OF_STOCK: styles.statusOut,
  DISCONTINUED: styles.statusArchived,
};

function StatusPill({ status }: { status: Product["status"] }) {
  return (
    <span className={`${styles.pill} ${STATUS_CLASS[status] ?? styles.statusArchived}`}>{STATUS_DISPLAY[status] ?? status}</span>
  );
}

function Thumb({ product, large = false }: { product: Product; large?: boolean }) {
  const src = photoOf(product);
  const cls = large ? styles.photoLarge : styles.thumb;
  if (!src) {
    return (
      <span className={`${cls} ${styles.thumbEmpty}`} aria-hidden="true">
        <Package size={large ? 28 : 16} />
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- uploaded files come from the media bucket
  return <img src={src} alt="" className={cls} loading="lazy" />;
}

function StockCell({ stock }: { stock: ProductStock | null }) {
  if (!stock) return <span className={styles.muted}>—</span>;
  const level = stockLevel(stock);
  if (level === "untracked") return <span className={styles.muted}>Not tracked</span>;
  return (
    <span className={styles.stock}>
      <span className={`${styles.dot} ${level === "out" ? styles.dotOut : level === "low" ? styles.dotLow : styles.dotOk}`} aria-hidden="true" />
      <span className={styles.tabular}>{stock.available.toLocaleString()}</span>
      <span className={styles.sub}>{level === "out" ? "Out of stock" : level === "low" ? "Running low" : "in stock"}</span>
    </span>
  );
}

function Price({ product }: { product: Product }) {
  const off = discountPercent(product);
  return (
    <span className={styles.price}>
      <span className={styles.strong}>{formatTaka(product.base_price)}</span>
      {off !== null && (
        <>
          <span className={styles.was}>{formatTaka(product.compare_at_price)}</span>
          <span className={styles.off}>−{off}%</span>
        </>
      )}
    </span>
  );
}

function RowActions({ product, busy, onEdit, onPhotos, onArchive, onSetStatus }: {
  product: Product;
  busy: boolean;
} & Pick<ProductListProps, "onEdit" | "onPhotos" | "onArchive" | "onSetStatus">) {
  if (product.status === "ARCHIVED") {
    return (
      <button
        type="button"
        className={styles.textAction}
        disabled={busy}
        onClick={() => onSetStatus(product, "DRAFT")}
        title="Bring it back as a draft"
      >
        <ArchiveRestore size={14} /> Restore
      </button>
    );
  }
  return (
    <span className={styles.rowActions}>
      {product.status === "DRAFT" && (
        <button type="button" className={styles.textAction} disabled={busy} onClick={() => onSetStatus(product, "ACTIVE")}>
          <Send size={14} /> Publish
        </button>
      )}
      <button type="button" className={styles.iconAction} onClick={() => onEdit(product)} aria-label={`Edit ${product.name}`} title="Edit">
        <Pencil size={15} />
      </button>
      <button type="button" className={styles.iconAction} onClick={() => onPhotos(product)} aria-label={`Photos of ${product.name}`} title="Photos">
        <Images size={15} />
      </button>
      <button
        type="button"
        className={`${styles.iconAction} ${styles.iconDanger}`}
        disabled={busy}
        onClick={() => onArchive(product)}
        aria-label={`Archive ${product.name}`}
        title="Archive"
      >
        <Archive size={15} />
      </button>
    </span>
  );
}

export function ProductList(props: ProductListProps) {
  const { products, view, categoryNames, stock, selected, busyId, onToggle, onToggleAll } = props;
  const allChecked = products.length > 0 && products.every((p) => selected.has(p.id));
  const someChecked = !allChecked && products.some((p) => selected.has(p.id));

  if (view === "grid") {
    return (
      <div className={styles.grid}>
        {products.map((p) => {
          const checked = selected.has(p.id);
          const category = p.category_id ? categoryNames.get(p.category_id) : undefined;
          return (
            <article key={p.id} className={`${styles.card} ${checked ? styles.cardSelected : ""} ${p.status === "ARCHIVED" ? styles.dim : ""}`}>
              <div className={styles.cardMedia}>
                <Thumb product={p} large />
                <input
                  type="checkbox"
                  className={`${styles.checkbox} ${styles.cardCheck}`}
                  aria-label={`Select ${p.name}`}
                  checked={checked}
                  onChange={() => onToggle(p.id)}
                />
                <span className={styles.cardStatus}>
                  <StatusPill status={p.status} />
                </span>
              </div>
              <div className={styles.cardBody}>
                <button type="button" className={styles.nameButton} onClick={() => props.onEdit(p)} disabled={p.status === "ARCHIVED"}>
                  {p.name}
                </button>
                <span className={styles.sub}>
                  {category ?? "No category"} · <code className={styles.sku}>{p.sku}</code>
                </span>
                <Price product={p} />
                <div className={styles.cardFoot}>
                  <StockCell stock={stockOf(p, stock)} />
                  <RowActions product={p} busy={busyId === p.id} {...props} />
                </div>
              </div>
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.checkCol}>
              <input
                type="checkbox"
                className={styles.checkbox}
                aria-label="Select all products on this page"
                checked={allChecked}
                ref={(el) => {
                  if (el) el.indeterminate = someChecked;
                }}
                onChange={onToggleAll}
              />
            </th>
            <th>Product</th>
            <th className={styles.num}>Price</th>
            <th>Stock</th>
            <th>Status</th>
            <th className={styles.actionCol}>
              <span className={styles.srOnly}>Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const checked = selected.has(p.id);
            const category = p.category_id ? categoryNames.get(p.category_id) : undefined;
            return (
              <tr key={p.id} className={`${styles.row} ${checked ? styles.rowSelected : ""} ${p.status === "ARCHIVED" ? styles.dim : ""}`}>
                <td className={styles.checkCol}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    aria-label={`Select ${p.name}`}
                    checked={checked}
                    onChange={() => onToggle(p.id)}
                  />
                </td>
                <td className={styles.productCell}>
                  <div className={styles.identity}>
                    <Thumb product={p} />
                    <div className={styles.identityText}>
                      <button type="button" className={styles.nameButton} onClick={() => props.onEdit(p)} disabled={p.status === "ARCHIVED"}>
                        {p.name}
                      </button>
                      <span className={styles.meta}>
                        <code className={styles.sku}>{p.sku}</code>
                        <span className={category ? undefined : styles.muted}>{category ?? "No category"}</span>
                        <span className={styles.variants} title="Variants">
                          <Layers size={12} aria-hidden="true" />
                          {p.variants?.length || 1}
                        </span>
                      </span>
                    </div>
                  </div>
                </td>
                <td className={styles.num}>
                  <Price product={p} />
                </td>
                <td>
                  <StockCell stock={stockOf(p, stock)} />
                </td>
                <td>
                  <StatusPill status={p.status} />
                </td>
                <td className={styles.actionCol}>
                  <RowActions product={p} busy={busyId === p.id} {...props} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
