"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useDebounce } from "@/hooks/useDebounce";
import { NewOrderPanel } from "@/components/orders/NewOrderPanel";
import { OrderDetailPanel } from "@/components/orders/OrderDetailPanel";
import { OrdersHeader, OrdersSummary, OrdersTable, type OrderListItem, type StatusCounts } from "@/components/orders/OrdersList";
import ws from "@/components/ui/WorkScreen/WorkScreen.module.css";

const PAGE_SIZE = 25;

/**
 * Orders: what needs doing (summary + status tabs from real counts), one page of orders at a time, and two side
 * panels: a new order taken by hand, and one order's details with its next step.
 */
export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const [totalCount, setTotalCount] = useState(0);
  const [listError, setListError] = useState<string | null>(null);
  const [statusCounts, setStatusCounts] = useState<StatusCounts | null>(null);
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const loadOrders = useCallback(async (p: number, status: string, q: string) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(p * PAGE_SIZE) });
      if (status !== "ALL") params.append("status", status);
      if (q.trim()) params.append("search", q.trim());
      const res = await fetch(`/api/v1/orders?${params.toString()}`);
      const json = await res.json().catch(() => null);
      if (res.ok) {
        setListError(null);
        setOrders(json?.data || []);
        setTotalCount(json?.meta?.total || (json?.data ? json.data.length : 0));
      } else {
        setListError(json?.error?.message || "Could not load orders.");
      }
    } catch {
      setListError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Real counts over every order, for the summary and the status tabs
  const loadCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/orders/summary");
      if (res.ok) {
        const json = await res.json();
        setStatusCounts(json.data?.counts ?? {});
      }
    } catch {
      // Without counts the tabs and summary show "–"; the list still works
    }
  }, []);

  const reload = useCallback(
    () => Promise.all([loadOrders(page, statusFilter, debouncedSearchQuery), loadCounts()]).then(() => undefined),
    [loadOrders, loadCounts, page, statusFilter, debouncedSearchQuery],
  );

  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  useEffect(() => {
    void loadOrders(page, statusFilter, debouncedSearchQuery);
  }, [loadOrders, page, statusFilter, debouncedSearchQuery]);

  // "C" opens a new order, as on Payments (not while typing or while a panel is open)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      const typing = Boolean(el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)));
      if (event.key.toLowerCase() !== "c" || event.metaKey || event.ctrlKey || event.altKey || typing || creating || openOrderId) return;
      event.preventDefault();
      setCreating(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [creating, openOrderId]);

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    setPage(0);
  };

  const handleStatusChange = (status: string) => {
    setStatusFilter(status);
    setPage(0);
  };

  const closeCreate = useCallback(() => setCreating(false), []);
  const closeDetail = useCallback(() => setOpenOrderId(null), []);

  return (
    <div className={ws.page}>
      <OrdersHeader onCreate={() => setCreating(true)} />
      <OrdersSummary counts={statusCounts} />
      <OrdersTable
        orders={orders}
        counts={statusCounts}
        isLoading={isLoading}
        error={listError}
        onRetry={() => void loadOrders(page, statusFilter, debouncedSearchQuery)}
        totalCount={totalCount}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        statusFilter={statusFilter}
        onStatusChange={handleStatusChange}
        searchQuery={searchQuery}
        onSearch={handleSearch}
        onOpen={setOpenOrderId}
        onCreate={() => setCreating(true)}
      />

      {creating && (
        <NewOrderPanel
          onClose={closeCreate}
          onCreated={async (created) => {
            setCreating(false);
            await reload();
            // Show the new order straight away, with its next step
            if (created.id) setOpenOrderId(created.id);
          }}
        />
      )}

      {openOrderId && <OrderDetailPanel key={openOrderId} orderId={openOrderId} onClose={closeDetail} onChanged={reload} />}
    </div>
  );
}
