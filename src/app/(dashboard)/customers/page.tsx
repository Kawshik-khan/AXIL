"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Users, Plus, Search, Download } from "lucide-react";
import { Button } from "@/components/ui/Button/Button";
import { Input } from "@/components/ui/Input/Input";
import { EmptyState, ErrorState, LoadingState, PermissionDenied } from "@/components/ui/States/States";
import { useDebounce } from "@/hooks/useDebounce";
import { CUSTOMER_SORTS, type CustomerListItem, type CustomerSegment, type CustomerSort, type SegmentCounts } from "@/lib/customer-segments";
import { CustomerTable } from "./CustomerTable";
import { NewCustomerModal } from "./NewCustomerModal";
import { SegmentTiles } from "./SegmentTiles";
import { SEGMENT_LABELS, SORT_LABELS, customersCsv } from "./customer-display";
import styles from "./customers.module.css";

const PAGE_SIZE = 25;

type LoadError = { message: string; requestId?: string; status?: number };

export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const [segment, setSegment] = useState<CustomerSegment | null>(null);
  const [sort, setSort] = useState<CustomerSort>("newest");
  const [segmentCounts, setSegmentCounts] = useState<SegmentCounts | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);

  const loadCustomers = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE), sort });
      if (debouncedSearchQuery.trim()) params.append("search", debouncedSearchQuery.trim());
      if (segment) params.append("segment", segment);
      const res = await fetch(`/api/v1/customers?${params.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError({ message: json?.error?.message || `Customers could not be loaded (${res.status}).`, requestId: json?.error?.request_id, status: res.status });
        return;
      }
      const rows: CustomerListItem[] = json.data || [];
      setCustomers(rows);
      setTotalCount(json.meta?.total ?? rows.length);
      setSegmentCounts(json.meta?.segment_counts ?? null);
    } catch {
      setLoadError({ message: "Could not reach the server." });
    } finally {
      setIsLoading(false);
    }
  }, [page, sort, segment, debouncedSearchQuery]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  // A new filter shows its first page and starts a fresh selection
  const resetPaging = () => {
    setPage(0);
    setSelected(new Set());
  };

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      const allOn = customers.length > 0 && customers.every((c) => prev.has(c.id));
      const next = new Set(prev);
      for (const c of customers) {
        if (allOn) next.delete(c.id);
        else next.add(c.id);
      }
      return next;
    });

  /** Downloads the selected customers on this page, or the whole page when none is selected. */
  const exportCsv = () => {
    const rows = selected.size > 0 ? customers.filter((c) => selected.has(c.id)) : customers;
    if (rows.length === 0) return;
    const blob = new Blob(["﻿" + customersCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loadError?.status === 403) return <PermissionDenied resource="customers" requiredPermission="customers.read" />;

  const isFiltered = Boolean(segment || debouncedSearchQuery.trim());

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>Customers</h1>
          </div>
          <p className={styles.subtitle}>Everyone who has ordered or messaged your shop, in one place.</p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.ghostButton} onClick={exportCsv} disabled={customers.length === 0}>
            <Download size={15} />
            {selected.size > 0 ? `Export ${selected.size} selected` : "Export CSV"}
          </button>
          <button type="button" className={styles.inkButton} onClick={() => setIsModalOpen(true)}>
            <Plus size={16} /> New customer
          </button>
        </div>
      </header>

      <nav className={styles.tabs} aria-label="Customers">
        <Link href="/customers" className={styles.tab} aria-current="page">
          All customers
        </Link>
        <Link href="/customers/lifecycle" className={styles.tab}>
          Lifecycle
        </Link>
      </nav>

      <SegmentTiles
        counts={segmentCounts}
        active={segment}
        onPick={(s) => {
          setSegment(s);
          resetPaging();
        }}
      />

      <section className={styles.panel} aria-label="Customer list">
          <div className={styles.toolbar}>
            <div className={styles.tools}>
              <div className={styles.search}>
                <Input
                  type="search"
                  aria-label="Search customers"
                  placeholder="Search name, phone or email"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    resetPaging();
                  }}
                  leftIcon={<Search size={15} color="var(--color-text-secondary)" />}
                />
              </div>
              {segment && <span className={styles.selection}>{SEGMENT_LABELS[segment]} customers</span>}
            </div>
            <div className={styles.tools}>
              {selected.size > 0 && <span className={styles.selection}>{selected.size} selected</span>}
              <label className={styles.sortLabel}>
                Sort
                <select
                  className={styles.sortSelect}
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value as CustomerSort);
                    resetPaging();
                  }}
                >
                  {CUSTOMER_SORTS.map((s) => (
                    <option key={s} value={s}>
                      {SORT_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {isLoading ? (
            <LoadingState message="Loading customers…" />
          ) : loadError ? (
            <ErrorState message={loadError.message} requestId={loadError.requestId} onRetry={() => loadCustomers()} />
          ) : customers.length === 0 ? (
            <EmptyState
              icon={<Users size={36} color="var(--color-text-secondary)" />}
              title={isFiltered ? "No customers match" : "No customers yet"}
              description={
                isFiltered
                  ? "Try another segment or search, or add the customer yourself."
                  : "Customers appear here when they order or message your shop. You can also add one yourself."
              }
              actionText="+ Add customer"
              onAction={() => setIsModalOpen(true)}
            />
          ) : (
            <>
              <CustomerTable
                customers={customers}
                selected={selected}
                onToggle={toggleSelected}
                onToggleAll={toggleAll}
                onOpen={(id) => router.push(`/customers/${encodeURIComponent(id)}`)}
              />
              <div className={styles.footer}>
                <span>
                  {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()}
                </span>
                {totalCount > PAGE_SIZE && (
                  <div className={styles.pager}>
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((prev) => Math.max(0, prev - 1))}>
                      Previous
                    </Button>
                    <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= totalCount} onClick={() => setPage((prev) => prev + 1)}>
                      Next
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
      </section>

      <NewCustomerModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onCreated={loadCustomers} />
    </div>
  );
}
