"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Archive, LayoutGrid, List, Package, Plus, Search, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/Button/Button";
import { Input } from "@/components/ui/Input/Input";
import { EmptyState, ErrorState, LoadingState, PermissionDenied } from "@/components/ui/States/States";
import { BulkImportModal } from "@/components/catalog/BulkImportModal";
import { ProductPhotosModal } from "@/components/catalog/ProductPhotosModal";
import type { Category, Product } from "@/types/commerce";
import { useDebounce } from "@/hooks/useDebounce";
import { RestockPanel, StatusTiles, type StatusCounts } from "./CatalogOverview";
import { ProductFormModal } from "./ProductFormModal";
import { ProductList, type ProductView } from "./ProductList";
import { PRODUCT_STATUSES, STATUS_LABELS, restockList, stockByVariant, type ListedStatus, type StockRow } from "./product-display";
import styles from "./products.module.css";

const PAGE_SIZE = 24;
const VIEW_KEY = "commerceos.products.view";

type LoadError = { message: string; requestId?: string; status?: number };

async function readError(res: Response, fallback: string): Promise<LoadError> {
  const json = await res.json().catch(() => ({}));
  return { message: json?.error?.message || fallback, requestId: json?.error?.request_id, status: res.status };
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [status, setStatus] = useState<ListedStatus | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [view, setView] = useState<ProductView>("table");

  const [counts, setCounts] = useState<StatusCounts | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stockRows, setStockRows] = useState<StockRow[] | null>(null);
  const [stockNote, setStockNote] = useState<string | undefined>();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [photosProduct, setPhotosProduct] = useState<Product | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // The view choice is a local preference only
  useEffect(() => {
    const saved = window.localStorage.getItem(VIEW_KEY);
    if (saved === "grid" || saved === "table") setView(saved);
  }, []);
  const chooseView = (next: ProductView) => {
    setView(next);
    window.localStorage.setItem(VIEW_KEY, next);
  };

  const loadProducts = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (status) params.set("status", status);
      if (categoryId) params.set("category_id", categoryId);
      const res = await fetch(`/api/v1/products?${params.toString()}`);
      if (!res.ok) {
        setLoadError(await readError(res, `Products could not be loaded (${res.status}).`));
        return;
      }
      const json = await res.json();
      const rows: Product[] = json.data || [];
      setProducts(rows);
      setTotalCount(json.meta?.total ?? rows.length);
    } catch {
      setLoadError({ message: "Could not reach the server." });
    } finally {
      setIsLoading(false);
    }
  }, [page, debouncedSearch, status, categoryId]);

  /** One count per status, read from each filtered list's total. */
  const loadCounts = useCallback(async () => {
    try {
      const totals = await Promise.all(
        PRODUCT_STATUSES.map(async (s) => {
          const res = await fetch(`/api/v1/products?status=${s}&limit=1`);
          if (!res.ok) throw new Error();
          const json = await res.json();
          return [s, Number(json.meta?.total ?? 0)] as const;
        })
      );
      setCounts(Object.fromEntries(totals) as StatusCounts);
    } catch {
      setCounts(null);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/categories");
      if (!res.ok) return;
      const json = await res.json();
      setCategories((json.data?.categories || []).filter((c: Category) => c.status !== "ARCHIVED"));
    } catch {
      // Filters and the form still work without the list; a typed category is created on save
    }
  }, []);

  const loadStock = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/inventory");
      if (res.status === 403) {
        setStockRows(null);
        setStockNote("Your role cannot see stock levels (needs inventory.read).");
        return;
      }
      if (!res.ok) {
        const err = await readError(res, "Stock levels could not be loaded.");
        setStockRows(null);
        setStockNote(err.requestId ? `${err.message} (request ${err.requestId})` : err.message);
        return;
      }
      const json = await res.json();
      setStockRows(json.data?.inventory || []);
      setStockNote(undefined);
    } catch {
      setStockRows(null);
      setStockNote("Could not reach the server for stock levels.");
    }
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    loadCounts();
    loadCategories();
    loadStock();
  }, [loadCounts, loadCategories, loadStock]);

  const refreshAll = async () => {
    setSelected(new Set());
    await Promise.all([loadProducts(), loadCounts(), loadStock()]);
  };

  // A new filter shows its first page and starts a fresh selection
  const resetPaging = () => {
    setPage(0);
    setSelected(new Set());
  };

  const categoryNames = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const stockIndex = useMemo(() => (stockRows ? stockByVariant(stockRows) : null), [stockRows]);
  const restock = useMemo(() => (stockRows ? restockList(stockRows) : null), [stockRows]);

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      const allOn = products.length > 0 && products.every((p) => prev.has(p.id));
      const next = new Set(prev);
      for (const p of products) {
        if (allOn) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });

  const archiveOne = async (product: Product) => {
    if (!window.confirm(`Archive "${product.name}"? Customers will no longer be able to order it.`)) return;
    setActionError(null);
    setBusyId(product.id);
    try {
      const res = await fetch(`/api/v1/products/${encodeURIComponent(product.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await readError(res, "The product could not be archived.");
        setActionError(err.requestId ? `${err.message} (request ${err.requestId})` : err.message);
        return;
      }
      await refreshAll();
    } catch {
      setActionError("Could not reach the server.");
    } finally {
      setBusyId(null);
    }
  };

  const setProductStatus = async (product: Product, next: "ACTIVE" | "DRAFT") => {
    setActionError(null);
    setBusyId(product.id);
    try {
      const res = await fetch(`/api/v1/products/${encodeURIComponent(product.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const err = await readError(res, "The status could not be changed.");
        setActionError(err.requestId ? `${err.message} (request ${err.requestId})` : err.message);
        return;
      }
      await refreshAll();
    } catch {
      setActionError("Could not reach the server.");
    } finally {
      setBusyId(null);
    }
  };

  /** Archives the selected products one by one and reports any that failed. */
  const archiveSelected = async () => {
    const targets = products.filter((p) => selected.has(p.id) && p.status !== "ARCHIVED");
    if (targets.length === 0) return;
    if (!window.confirm(`Archive ${targets.length} product${targets.length === 1 ? "" : "s"}? Customers will no longer be able to order them.`)) return;
    setActionError(null);
    setBulkBusy(true);
    const failed: string[] = [];
    for (const p of targets) {
      try {
        const res = await fetch(`/api/v1/products/${encodeURIComponent(p.id)}`, { method: "DELETE" });
        if (!res.ok) failed.push(p.name);
      } catch {
        failed.push(p.name);
      }
    }
    setBulkBusy(false);
    if (failed.length > 0) setActionError(`Not archived: ${failed.join(", ")}.`);
    await refreshAll();
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  if (loadError?.status === 403) return <PermissionDenied resource="products" requiredPermission="products.read" />;

  const isFiltered = Boolean(status || categoryId || debouncedSearch.trim());
  const archivableSelected = products.filter((p) => selected.has(p.id) && p.status !== "ARCHIVED").length;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Products</h1>
          <p className={styles.subtitle}>Your catalog: prices, photos and stock your AI agents sell from.</p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.ghostButton} onClick={() => setImportOpen(true)}>
            <UploadCloud size={15} /> Import CSV
          </button>
          <button type="button" className={styles.inkButton} onClick={openCreate}>
            <Plus size={16} /> New product
          </button>
        </div>
      </header>

      <StatusTiles
        counts={counts}
        active={status}
        onPick={(s) => {
          setStatus(s);
          resetPaging();
        }}
      />

      <div className={styles.layout}>
        <section className={styles.panel} aria-label="Product list">
          <div className={styles.toolbar}>
            <div className={styles.tools}>
              <div className={styles.search}>
                <Input
                  type="search"
                  aria-label="Search products"
                  placeholder="Search name or SKU"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    resetPaging();
                  }}
                  leftIcon={<Search size={15} color="var(--color-text-secondary)" />}
                />
              </div>
              <select
                className={styles.toolSelect}
                aria-label="Filter by category"
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  resetPaging();
                }}
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {status && (
                <button
                  type="button"
                  className={styles.filterChip}
                  onClick={() => {
                    setStatus(null);
                    resetPaging();
                  }}
                >
                  {STATUS_LABELS[status]} <X size={13} aria-label="Clear status filter" />
                </button>
              )}
            </div>
            <div className={styles.tools}>
              {selected.size > 0 && (
                <>
                  <span className={styles.selection}>{selected.size} selected</span>
                  <button
                    type="button"
                    className={styles.toolButton}
                    onClick={archiveSelected}
                    disabled={bulkBusy || archivableSelected === 0}
                  >
                    <Archive size={14} /> {bulkBusy ? "Archiving…" : "Archive"}
                  </button>
                </>
              )}
              <div className={styles.segmented} role="group" aria-label="View">
                <button type="button" aria-pressed={view === "table"} onClick={() => chooseView("table")} title="Table view">
                  <List size={15} />
                  <span className={styles.srOnly}>Table view</span>
                </button>
                <button type="button" aria-pressed={view === "grid"} onClick={() => chooseView("grid")} title="Grid view">
                  <LayoutGrid size={15} />
                  <span className={styles.srOnly}>Grid view</span>
                </button>
              </div>
            </div>
          </div>

          {actionError && (
            <div className={styles.banner} role="alert">
              <AlertCircle size={15} />
              <span>{actionError}</span>
              <button type="button" className={styles.bannerClose} onClick={() => setActionError(null)} aria-label="Dismiss">
                <X size={14} />
              </button>
            </div>
          )}

          {isLoading ? (
            <LoadingState message="Loading products…" />
          ) : loadError ? (
            <ErrorState message={loadError.message} requestId={loadError.requestId} onRetry={() => loadProducts()} />
          ) : products.length === 0 ? (
            <EmptyState
              icon={<Package size={36} color="var(--color-text-secondary)" />}
              title={isFiltered ? "No products match" : "No products yet"}
              description={
                isFiltered
                  ? "Try another search, status or category."
                  : "Add products so customers can order them and your AI agents can recommend them."
              }
              actionText={isFiltered ? undefined : "+ Add product"}
              onAction={isFiltered ? undefined : openCreate}
            />
          ) : (
            <>
              <ProductList
                products={products}
                view={view}
                categoryNames={categoryNames}
                stock={stockIndex}
                selected={selected}
                busyId={busyId}
                onToggle={toggleSelected}
                onToggleAll={toggleAll}
                onEdit={(p) => {
                  setEditing(p);
                  setFormOpen(true);
                }}
                onPhotos={setPhotosProduct}
                onArchive={archiveOne}
                onSetStatus={setProductStatus}
              />
              <div className={styles.footer}>
                <span>
                  {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()}
                </span>
                {totalCount > PAGE_SIZE && (
                  <div className={styles.pager}>
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={(page + 1) * PAGE_SIZE >= totalCount}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        <RestockPanel restock={restock} note={stockNote} />
      </div>

      <ProductFormModal
        isOpen={formOpen}
        product={editing}
        categories={categories}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSaved={refreshAll}
        onCategoryCreated={loadCategories}
      />

      <ProductPhotosModal
        product={photosProduct}
        onClose={() => setPhotosProduct(null)}
        onSaved={async () => {
          setPhotosProduct(null);
          await loadProducts();
        }}
      />

      <BulkImportModal isOpen={importOpen} onClose={() => setImportOpen(false)} onSuccess={refreshAll} />
    </div>
  );
}
