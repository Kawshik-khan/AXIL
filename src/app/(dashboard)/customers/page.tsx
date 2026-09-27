"use client";

import React, { useEffect, useState } from "react";
import {
  Users,
  Plus,
  Search,
  Phone,
  Mail,
  MapPin,
  ShoppingBag,
  CheckCircle2,
  AlertCircle,
  Eye,
} from "lucide-react";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { Input } from "@/components/ui/Input/Input";
import { Modal } from "@/components/ui/Modal/Modal";
import { Badge } from "@/components/ui/Badge/Badge";
import { EmptyState, LoadingState } from "@/components/ui/States/States";
import { Customer } from "@/types/commerce";

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // Customer Drawer
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
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
  const PAGE_SIZE = 25;

  const loadCustomers = async (p = page, q = searchQuery) => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(p * PAGE_SIZE),
      });
      if (q.trim()) {
        params.append("search", q.trim());
      }
      const res = await fetch(`/api/v1/customers?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setCustomers(json.data || []);
        setTotalCount(json.meta?.total || (json.data ? json.data.length : 0));
      }
    } catch (err) {
      console.error("Failed to load customers:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers(page, searchQuery);
  }, [page]);

  const handleSearch = (val: string) => {
    setSearchQuery(val);
    setPage(0);
    loadCustomers(0, val);
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
    } catch (err: any) {
      setFormError(err.message || "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredCustomers = customers.filter((c) => {
    const query = searchQuery.toLowerCase();
    return (
      c.first_name.toLowerCase().includes(query) ||
      c.last_name.toLowerCase().includes(query) ||
      c.phone.includes(query) ||
      (c.email && c.email.toLowerCase().includes(query))
    );
  });

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>Customer Directory</h1>
          <p style={{ color: "var(--color-text-muted)", fontSize: "14px", marginTop: "4px" }}>
            Unified customer profiles with phone deduplication (+880 normalization) and lifetime spend tracking.
          </p>
        </div>
        <Button variant="primary" size="md" onClick={() => setIsModalOpen(true)}>
          <Plus size={16} style={{ marginRight: 6 }} /> New Customer
        </Button>
      </div>

      <div style={{ marginBottom: "20px" }}>
        <Input
          placeholder="Search by name, phone (+880...), or email..."
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          leftIcon={<Search size={16} color="var(--color-text-muted)" />}
        />
      </div>

      <BentoCard span={12} title="Verified Customers" subtitle={`Total registered: ${totalCount.toLocaleString()} customers across Bangladesh`}>
        {isLoading ? (
          <LoadingState message="Fetching customer directory from database..." />
        ) : customers.length === 0 ? (
          <EmptyState
            icon={<Users size={36} color="var(--color-lime-hover)" />}
            title="No customers found"
            description="No customers match your search criteria. You can clear the search or register a new customer."
            actionText="+ Add Customer"
            onAction={() => setIsModalOpen(true)}
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border-subtle)", textAlign: "left" }}>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Name</th>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Phone</th>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Email</th>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Orders</th>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Total Spent</th>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Source</th>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)", textAlign: "right" }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {customers.map((cust) => (
                  <tr key={cust.id} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
                    <td style={{ padding: "14px 10px", fontWeight: 600 }}>
                      {cust.first_name} {cust.last_name}
                    </td>
                    <td style={{ padding: "14px 10px" }}>
                      <code>{cust.phone}</code>
                    </td>
                    <td style={{ padding: "14px 10px", color: "var(--color-text-muted)" }}>
                      {cust.email || "—"}
                    </td>
                    <td style={{ padding: "14px 10px" }}>{cust.total_orders}</td>
                    <td style={{ padding: "14px 10px", fontWeight: 600 }}>
                      {(cust.total_spent ?? 0).toLocaleString("en-BD")} ৳
                    </td>
                    <td style={{ padding: "14px 10px" }}>
                      <Badge variant="default">{cust.source || "MANUAL"}</Badge>
                    </td>
                    <td style={{ padding: "14px 10px", textAlign: "right" }}>
                      <Button variant="outline" size="sm" onClick={() => openCustomerDetails(cust.id)}>
                        <Eye size={14} style={{ marginRight: 4 }} /> View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination Controls */}
            {totalCount > PAGE_SIZE && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px", paddingTop: "12px", borderTop: "1px solid var(--color-border-subtle)" }}>
                <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
                  Showing {page * PAGE_SIZE + 1} to {Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()} customers
                </span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((prev) => Math.max(0, prev - 1))}
                  >
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
              </div>
            )}
          </div>
        )}
      </BentoCard>

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
                background: "rgba(0,0,0,0.02)",
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
                  {selectedCustomer.addresses.map((addr: any) => (
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
              {(selectedCustomer.orders || []).length === 0 ? (
                <p style={{ color: "var(--color-text-muted)" }}>No prior orders found.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {selectedCustomer.orders.map((o: any) => (
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
