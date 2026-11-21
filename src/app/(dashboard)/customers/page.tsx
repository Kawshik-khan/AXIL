"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Users, Plus, Search, AlertCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/Button/Button";
import { Input } from "@/components/ui/Input/Input";
import { Modal } from "@/components/ui/Modal/Modal";
import { Badge } from "@/components/ui/Badge/Badge";
import { EmptyState, LoadingState } from "@/components/ui/States/States";
import { useDebounce } from "@/hooks/useDebounce";
import type { Customer, CustomerAddress, Order } from "@/types/commerce";
import {
  CUSTOMER_SEGMENTS,
  CUSTOMER_SORTS,
  type CustomerListItem,
  type CustomerSegment,
  type CustomerSort,
  type SegmentCounts,
} from "@/lib/customer-segments";
import { CustomerTable } from "./CustomerTable";
import { SEGMENT_LABELS, SORT_LABELS, customersCsv } from "./customer-display";
import styles from "./customers.module.css";

const PAGE_SIZE = 25;

/** GET /api/v1/customers/:id; `orders` is null when the role can't read orders. */
interface CustomerDetails {
  customer: Customer;
  addresses?: CustomerAddress[];
  orders: Order[] | null;
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  // Debounce search query to reduce API calls while typing
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const [segment, setSegment] = useState<CustomerSegment | null>(null);
  const [sort, setSort] = useState<CustomerSort>("newest");
  const [segmentCounts, setSegmentCounts] = useState<SegmentCounts | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // Customer Drawer
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetails | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  // New customer form
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [division, setDivision] = useState("Dhaka");
  const [district, setDistrict] = useState("Dhaka");
  const [addressLine, setAddressLine] = useState("");

  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);

  const loadCustomers = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError("");
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
        sort,
      });
      if (debouncedSearchQuery.trim()) params.append("search", debouncedSearchQuery.trim());
      if (segment) params.append("segment", segment);
      const res = await fetch(`/api/v1/customers?${params.toString()}`);
      if (!res.ok) throw new Error(`Customers could not be loaded (${res.status}).`);
      const json = await res.json();
      setCustomers(json.data || []);
      setTotalCount(json.meta?.total ?? (json.data ? json.data.length : 0));
      setSegmentCounts(json.meta?.segment_counts ?? null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Customers could not be loaded.");
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

  const handleSearch = (val: string) => {
    setSearchQuery(val);
    resetPaging();
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

  const openCustomerDetails = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/customers/${id}`);
      if (res.ok) {
        const json = await res.json();
        setSelectedCustomer(json.data);
        setIsDetailsOpen(true);
      }
    } catch (err) {
      console.error("Failed to load customer details:", err);
    }
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!firstName.trim()) {
      setFormError("First name is required.");
      return;
    }
    if (!phone.trim()) {
      setFormError("Phone number is required.");
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await fetch("/api/v1/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim() || "Customer",
          phone: phone.trim(),
          email: email.trim() || undefined,
          address: addressLine.trim()
            ? {
                division,
                district,
                address_line_1: addressLine.trim(),
              }
            : undefined,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error?.message || "Failed to create customer");
      }

      setIsModalOpen(false);
      setFirstName("");
      setLastName("");
      setPhone("");
      setEmail("");
      setAddressLine("");
      await loadCustomers();
    } catch (err) {
      setFormError(err instanceof Error && err.message ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const allCount = segmentCounts ? CUSTOMER_SEGMENTS.reduce((sum, s) => sum + segmentCounts[s], 0) : totalCount;
  const chips: Array<{ key: CustomerSegment | null; label: string; count: number | undefined }> = [
    { key: null, label: "All", count: allCount },
    ...CUSTOMER_SEGMENTS.map((s) => ({ key: s, label: SEGMENT_LABELS[s], count: segmentCounts?.[s] })),
  ];
  const isFiltered = Boolean(segment || debouncedSearchQuery.trim());

  return (
    <>
      <header className={styles.header}>
        <div>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>Customers</h1>
            {segmentCounts && <span className={styles.count}>{allCount.toLocaleString()}</span>}
          </div>
          <p className={styles.subtitle}>Everyone who has ordered from your shop, in one place.</p>
        </div>
        <div className={styles.actions}>
          <div className={styles.search}>
            <Input
              type="search"
              aria-label="Search customers"
              placeholder="Search name, phone or email"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              leftIcon={<Search size={15} color="var(--color-text-secondary)" />}
            />
          </div>
          <button type="button" className={styles.inkButton} onClick={() => setIsModalOpen(true)}>
            <Plus size={16} /> New customer
          </button>
        </div>
      </header>

      <section className={styles.panel} aria-label="Customer list">
        <div className={styles.toolbar}>
          <div className={styles.chips} role="group" aria-label="Filter by segment">
            {chips.map((chip) => {
              const active = segment === chip.key;
              return (
                <button
                  key={chip.label}
                  type="button"
                  aria-pressed={active}
                  className={`${styles.chip} ${active ? styles.chipActive : ""}`}
                  onClick={() => {
                    setSegment(chip.key);
                    resetPaging();
                  }}
                >
                  {chip.label}
                  {chip.count !== undefined && <span className={styles.chipCount}>{chip.count.toLocaleString()}</span>}
                </button>
              );
            })}
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
            <button type="button" className={styles.toolButton} onClick={exportCsv} disabled={customers.length === 0}>
              <Download size={14} />
              {selected.size > 0 ? "Export selected" : "Export CSV"}
            </button>
          </div>
        </div>

        {isLoading ? (
          <LoadingState message="Loading customers…" />
        ) : loadError ? (
          <EmptyState
            icon={<AlertCircle size={36} color="var(--color-danger)" />}
            title="Customers could not be loaded"
            description={loadError}
            actionText="Try again"
            onAction={() => loadCustomers()}
          />
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
              onOpen={openCustomerDetails}
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
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(page + 1) * PAGE_SIZE >= totalCount}
                    onClick={() => setPage((prev) => prev + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* Add Customer Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Register Customer">
        <form onSubmit={handleCreateCustomer} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {formError && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px",
                background: "rgba(239, 68, 68, 0.1)",
                color: "var(--color-danger)",
                borderRadius: "var(--radius-control)",
                fontSize: "13px",
              }}
            >
              <AlertCircle size={16} />
              <span>{formError}</span>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Input
              label="First Name *"
              placeholder="e.g. Mahfuz"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
            <Input
              label="Last Name"
              placeholder="e.g. Rahman"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>

          <Input
            label="Bangladeshi Mobile Phone *"
            placeholder="01712345678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            hint="Normalized automatically to canonical +880 format"
          />

          <Input
            label="Email Address (Optional)"
            type="email"
            placeholder="customer@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "13px", fontWeight: 500 }}>Division</label>
              <select
                value={division}
                onChange={(e) => setDivision(e.target.value)}
                style={{
                  padding: "10px",
                  borderRadius: "var(--radius-control)",
                  border: "1px solid var(--color-border-subtle)",
                  fontFamily: "inherit",
                  fontSize: "13px",
                  background: "var(--color-bg-primary)",
                }}
              >
                {["Dhaka", "Chittagong", "Rajshahi", "Khulna", "Sylhet", "Barisal", "Rangpur", "Mymensingh"].map(
                  (d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  )
                )}
              </select>
            </div>

            <Input
              label="District"
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
            />
          </div>

          <Input
            label="Street Address / Area"
            placeholder="e.g. House 4, Road 11, Banani"
            value={addressLine}
            onChange={(e) => setAddressLine(e.target.value)}
          />

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
            <Button variant="outline" type="button" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={isSubmitting}>
              Register Customer
            </Button>
          </div>
        </form>
      </Modal>

      {/* Customer Profile Drawer */}
      {selectedCustomer && (
        <Modal
          isOpen={isDetailsOpen}
          onClose={() => setIsDetailsOpen(false)}
          title={`${selectedCustomer.customer.first_name} ${selectedCustomer.customer.last_name}`}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "16px", fontSize: "13px" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "12px",
                padding: "12px",
                background: "var(--color-track)",
                borderRadius: "var(--radius-card)",
              }}
            >
              <div>
                <span style={{ color: "var(--color-text-secondary)" }}>Phone:</span>
                <div style={{ fontWeight: 600 }}>{selectedCustomer.customer.phone}</div>
              </div>
              <div>
                <span style={{ color: "var(--color-text-secondary)" }}>Lifetime Spend:</span>
                <div style={{ fontWeight: 600 }}>
                  {selectedCustomer.customer.total_spent?.toLocaleString("en-BD")} ৳
                </div>
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 600, marginBottom: "8px" }}>Saved Delivery Addresses</div>
              {(selectedCustomer.addresses || []).length === 0 ? (
                <p style={{ color: "var(--color-text-muted)" }}>No addresses recorded yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {(selectedCustomer.addresses ?? []).map((addr) => (
                    <div
                      key={addr.id}
                      style={{
                        padding: "10px",
                        border: "1px solid var(--color-border-subtle)",
                        borderRadius: "var(--radius-control)",
                      }}
                    >
                      <div>{addr.address_line_1}</div>
                      <div style={{ color: "var(--color-text-muted)", fontSize: "11px" }}>
                        {addr.district}, {addr.division} {addr.postal_code}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div style={{ fontWeight: 600, marginBottom: "8px" }}>Order History</div>
              {selectedCustomer.orders === null ? (
                <p style={{ color: "var(--color-text-muted)" }}>Your role can&apos;t view orders.</p>
              ) : (selectedCustomer.orders || []).length === 0 ? (
                <p style={{ color: "var(--color-text-muted)" }}>No prior orders found.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {selectedCustomer.orders.map((o) => (
                    <div
                      key={o.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "8px 10px",
                        border: "1px solid var(--color-border-subtle)",
                        borderRadius: "var(--radius-control)",
                      }}
                    >
                      <span>
                        <strong>{o.order_number}</strong> — {o.grand_total} ৳
                      </span>
                      <Badge variant={o.status === "DELIVERED" ? "active" : "pending"}>
                        {o.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
