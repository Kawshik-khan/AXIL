"use client";

import React, { useEffect, useState } from "react";
import { DistrictPicker, useDeliveryFees } from "@/components/orders/DistrictPicker";
import Link from "next/link";
import {
  ShoppingBag,
  Plus,
  Search,
  Filter,
  Eye,
  CheckCircle,
  XCircle,
  Truck,
  DollarSign,
  AlertCircle,
  Clock,
  ChevronRight,
  ShieldAlert,
} from "lucide-react";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { Input } from "@/components/ui/Input/Input";
import { Modal } from "@/components/ui/Modal/Modal";
import { Badge } from "@/components/ui/Badge/Badge";
import { EmptyState, LoadingState } from "@/components/ui/States/States";
import { Order, OrderStatus, PaymentMethod } from "@/types/commerce";

interface OrderListItem extends Order {
  customer_name: string;
  customer_phone: string;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  // Create Order Modal
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [orderFormError, setOrderFormError] = useState("");

  // New Order Form state
  const [custFirstName, setCustFirstName] = useState("");
  const [custLastName, setCustLastName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [district, setDistrict] = useState("");
  const deliveryFees = useDeliveryFees();
  const [addressLine, setAddressLine] = useState("");
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [orderQuantity, setOrderQuantity] = useState("1");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("COD");
  const [couponCode, setCouponCode] = useState("");

  // Order Details Modal
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const loadOrders = async (p = page, status = statusFilter, q = searchQuery) => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(p * PAGE_SIZE),
      });
      if (status !== "ALL") {
        params.append("status", status);
      }
      if (q.trim()) {
        params.append("search", q.trim());
      }
      const res = await fetch(`/api/v1/orders?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setOrders(json.data || []);
        setTotalCount(json.meta?.total || (json.data ? json.data.length : 0));
      }
    } catch (err) {
      console.error("Failed to load orders:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadProducts = async () => {
    try {
      const res = await fetch("/api/v1/products");
      if (res.ok) {
        const json = await res.json();
        setProducts(json.data || []);
      }
    } catch (err) {
      console.error("Failed to load products:", err);
    }
  };

  useEffect(() => {
    loadOrders(page, statusFilter, searchQuery);
  }, [page, statusFilter]);

  useEffect(() => {
    loadProducts();
  }, []);

  const handleSearch = (val: string) => {
    setSearchQuery(val);
    setPage(0);
    loadOrders(0, statusFilter, val);
  };

  const handleStatusChange = (newStatus: string) => {
    setStatusFilter(newStatus);
    setPage(0);
    loadOrders(0, newStatus, searchQuery);
  };

  const openOrderDetails = async (orderId: string) => {
    try {
      const res = await fetch(`/api/v1/orders/${orderId}`);
      if (res.ok) {
        const json = await res.json();
        setSelectedOrder(json.data);
        setIsDetailsOpen(true);
      }
    } catch (err) {
      console.error("Failed to load order details:", err);
    }
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrderFormError("");

    if (!custFirstName.trim() || !custPhone.trim()) {
      setOrderFormError("Customer name and phone number are required.");
      return;
    }
    if (!addressLine.trim()) {
      setOrderFormError("Delivery address is required.");
      return;
    }
    if (!district) {
      setOrderFormError("Choose the delivery district.");
      return;
    }
    if (!selectedVariantId) {
      setOrderFormError("Please select at least one product.");
      return;
    }

    try {
      setIsSubmittingOrder(true);
      const res = await fetch("/api/v1/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: {
            first_name: custFirstName.trim(),
            last_name: custLastName.trim() || "Customer",
            phone: custPhone.trim(),
          },
          // The server derives division and delivery zone from the district (FX-36: this sent "Chittagong" for
          // every outside-Dhaka order)
          delivery_address: {
            district,
            address_line_1: addressLine.trim(),
          },
          items: [
            {
              variant_id: selectedVariantId,
              quantity: parseInt(orderQuantity, 10) || 1,
            },
          ],
          payment_method: paymentMethod,
          coupon_code: couponCode.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error?.message || "Failed to create order");
      }

      setIsCreateModalOpen(false);
      setCustFirstName("");
      setCustLastName("");
      setCustPhone("");
      setAddressLine("");
      setCouponCode("");
      await loadOrders();
    } catch (err: any) {
      setOrderFormError(err.message || "An error occurred");
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  const handleTransition = async (targetStatus: OrderStatus, reason?: string) => {
    if (!selectedOrder) return;
    try {
      setIsTransitioning(true);
      const res = await fetch(`/api/v1/orders/${selectedOrder.order.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: targetStatus,
          reason: reason || `Transitioned to ${targetStatus} via Control Plane`,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        alert(`Error: ${errJson.error?.message || "Transition failed"}`);
        return;
      }

      await openOrderDetails(selectedOrder.order.id);
      await loadOrders();
    } catch (err) {
      console.error("Failed transition:", err);
    } finally {
      setIsTransitioning(false);
    }
  };

  const filteredOrders = orders.filter((o) => {
    const matchesSearch =
      o.order_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.customer_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.customer_phone?.includes(searchQuery);
    const matchesStatus = statusFilter === "ALL" || o.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: OrderStatus) => {
    switch (status) {
      case "DELIVERED":
        return <Badge variant="active">DELIVERED</Badge>;
      case "CONFIRMED":
      case "PROCESSING":
      case "READY_TO_SHIP":
      case "SHIPPED":
        return <Badge variant="role">{status}</Badge>;
      case "PENDING":
        return <Badge variant="pending">PENDING</Badge>;
      case "CANCELLED":
      case "RETURNED":
      case "REFUNDED":
        return <Badge variant="inactive">{status}</Badge>;
      default:
        return <Badge variant="default">{status}</Badge>;
    }
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>Order Management</h1>
          <p style={{ color: "var(--color-text-muted)", fontSize: "14px", marginTop: "4px" }}>
            Omnichannel order lifecycle, state machine transitions, and automated stock reservation.
          </p>
        </div>
        <Button variant="primary" size="md" onClick={() => setIsCreateModalOpen(true)}>
          <Plus size={16} style={{ marginRight: 6 }} /> Manual Order
        </Button>
      </div>

      {/* Filter and Search Bar */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "20px", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 300px" }}>
          <Input
            placeholder="Search by Order #, customer, or phone..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            leftIcon={<Search size={16} color="var(--color-text-muted)" />}
          />
        </div>
        <div style={{ display: "flex", gap: "6px", overflowX: "auto" }}>
          {["ALL", "PENDING", "CONFIRMED", "PROCESSING", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "CANCELLED"].map(
            (s) => (
              <button
                key={s}
                onClick={() => handleStatusChange(s)}
                style={{
                  padding: "8px 12px",
                  borderRadius: "var(--radius-control)",
                  fontSize: "12px",
                  fontWeight: 600,
                  border: "1px solid var(--color-border-subtle)",
                  background: statusFilter === s ? "var(--color-charcoal)" : "transparent",
                  color: statusFilter === s ? "var(--color-lime)" : "var(--color-text-secondary)",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {s}
              </button>
            )
          )}
        </div>
      </div>

      {/* Orders Table */}
      <BentoCard
        span={12}
        title="All Orders"
        subtitle={
          totalCount > 0
            ? `Showing ${page * PAGE_SIZE + 1} to ${Math.min((page + 1) * PAGE_SIZE, totalCount)} of ${totalCount.toLocaleString()} orders`
            : "No orders found"
        }
      >
        {isLoading ? (
          <LoadingState message="Querying authoritative orders ledger..." />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag size={36} color="var(--color-lime-hover)" />}
            title="No orders found"
            description="Create an order manually or take orders via Facebook/WhatsApp channels."
            actionText="+ Create Order"
            onAction={() => setIsCreateModalOpen(true)}
          />
        ) : (
          <div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--color-border-subtle)", textAlign: "left" }}>
                    <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Order #</th>
                    <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Customer</th>
                    <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Total</th>
                    <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Payment</th>
                    <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Status</th>
                    <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Created</th>
                    <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)", textAlign: "right" }}>
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
                      <td style={{ padding: "14px 10px", fontWeight: 700 }}>
                        <button
                          onClick={() => openOrderDetails(order.id)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "inherit",
                            fontWeight: 700,
                            cursor: "pointer",
                            textDecoration: "underline",
                          }}
                        >
                          {order.order_number}
                        </button>
                      </td>
                      <td style={{ padding: "14px 10px" }}>
                        <div style={{ fontWeight: 600 }}>{order.customer_name}</div>
                        <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                          {order.customer_phone}
                        </div>
                      </td>
                      <td style={{ padding: "14px 10px", fontWeight: 700 }}>
                        {order.grand_total.toLocaleString("en-BD")} ৳
                      </td>
                      <td style={{ padding: "14px 10px" }}>
                        <Badge variant={order.payment_status === "PAID" ? "active" : "pending"}>
                          {order.payment_method} · {order.payment_status}
                        </Badge>
                      </td>
                      <td style={{ padding: "14px 10px" }}>{getStatusBadge(order.status)}</td>
                      <td style={{ padding: "14px 10px", color: "var(--color-text-muted)", fontSize: "12px" }}>
                        {new Date(order.created_at).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td style={{ padding: "14px 10px", textAlign: "right" }}>
                        <Button variant="outline" size="sm" onClick={() => openOrderDetails(order.id)}>
                          <Eye size={14} style={{ marginRight: 4 }} /> View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalCount > PAGE_SIZE && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: "16px",
                  paddingTop: "12px",
                  borderTop: "1px solid var(--color-border-subtle)",
                }}
              >
                <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
                  Showing {page * PAGE_SIZE + 1} to {Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()} orders
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

      {/* Manual Order Creation Modal */}
      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="Create Manual Order">
        <form onSubmit={handleCreateOrder} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {orderFormError && (
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
              <span>{orderFormError}</span>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Input
              label="Customer First Name *"
              placeholder="e.g. Tanvir"
              value={custFirstName}
              onChange={(e) => setCustFirstName(e.target.value)}
              required
            />
            <Input
              label="Last Name"
              placeholder="e.g. Hossain"
              value={custLastName}
              onChange={(e) => setCustLastName(e.target.value)}
            />
          </div>

          <Input
            label="Phone Number (auto +880) *"
            placeholder="01712345678"
            value={custPhone}
            onChange={(e) => setCustPhone(e.target.value)}
            required
            hint="Bangladeshi mobile number"
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            {/* District decides the zone and the charge; the fee comes from settings (FX-36, was a literal in this form) */}
            <DistrictPicker
              district={district}
              onChange={setDistrict}
              fees={deliveryFees}
              labelStyle={{ fontSize: "13px", fontWeight: 500 }}
              selectStyle={{
                padding: "10px",
                borderRadius: "var(--radius-control)",
                border: "1px solid var(--color-border-subtle)",
                fontFamily: "inherit",
                fontSize: "13px",
                background: "var(--color-bg-primary)",
              }}
            />

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "13px", fontWeight: 500 }}>Payment Method *</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                style={{
                  padding: "10px",
                  borderRadius: "var(--radius-control)",
                  border: "1px solid var(--color-border-subtle)",
                  fontFamily: "inherit",
                  fontSize: "13px",
                  background: "var(--color-bg-primary)",
                }}
              >
                <option value="COD">Cash on Delivery (COD)</option>
                <option value="BKASH">bKash</option>
                <option value="NAGAD">Nagad</option>
              </select>
            </div>
          </div>

          <Input
            label="Street Address / Area *"
            placeholder="House 12, Road 4, Sector 7, Uttara, Dhaka"
            value={addressLine}
            onChange={(e) => setAddressLine(e.target.value)}
            required
          />

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "12px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "13px", fontWeight: 500 }}>Select Product &amp; Variant *</label>
              <select
                value={selectedVariantId}
                onChange={(e) => setSelectedVariantId(e.target.value)}
                required
                style={{
                  padding: "10px",
                  borderRadius: "var(--radius-control)",
                  border: "1px solid var(--color-border-subtle)",
                  fontFamily: "inherit",
                  fontSize: "13px",
                  background: "var(--color-bg-primary)",
                }}
              >
                <option value="">Select Item...</option>
                {products.flatMap((p) =>
                  (p.variants || []).map((v: any) => (
                    <option key={v.id} value={v.id}>
                      {p.name} ({v.title}) — {v.price} ৳
                    </option>
                  ))
                )}
              </select>
            </div>

            <Input
              label="Quantity *"
              type="number"
              min="1"
              value={orderQuantity}
              onChange={(e) => setOrderQuantity(e.target.value)}
              required
            />
          </div>

          <Input
            label="Coupon Code (Optional)"
            placeholder="e.g. EID2026"
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value)}
          />

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
            <Button variant="outline" type="button" onClick={() => setIsCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={isSubmittingOrder}>
              Create Order &amp; Reserve Stock
            </Button>
          </div>
        </form>
      </Modal>

      {/* Order Detail & State Transition Drawer/Modal */}
      {selectedOrder && (
        <Modal
          isOpen={isDetailsOpen}
          onClose={() => setIsDetailsOpen(false)}
          title={`Order ${selectedOrder.order.order_number}`}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "18px", fontSize: "13px" }}>
            {/* Status & Lifecycle Actions */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 14px",
                background: "rgba(0,0,0,0.03)",
                borderRadius: "var(--radius-card)",
              }}
            >
              <div>
                <span style={{ color: "var(--color-text-secondary)", marginRight: "8px" }}>Status:</span>
                {getStatusBadge(selectedOrder.order.status)}
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                {selectedOrder.order.status === "PENDING" && (
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleTransition("CONFIRMED")}
                      isLoading={isTransitioning}
                    >
                      Confirm Order
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTransition("CANCELLED", "Cancelled by customer")}
                      isLoading={isTransitioning}
                    >
                      Cancel
                    </Button>
                  </>
                )}
                {selectedOrder.order.status === "CONFIRMED" && (
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleTransition("PROCESSING")}
                      isLoading={isTransitioning}
                    >
                      Process Items
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTransition("CANCELLED", "Customer cancelled before packing")}
                      isLoading={isTransitioning}
                    >
                      Cancel
                    </Button>
                  </>
                )}
                {selectedOrder.order.status === "PROCESSING" && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleTransition("READY_TO_SHIP")}
                    isLoading={isTransitioning}
                  >
                    Mark Ready to Ship
                  </Button>
                )}
                {selectedOrder.order.status === "READY_TO_SHIP" && (
                  <Link href="/shipments">
                    <Button variant="primary" size="sm">
                      <Truck size={14} style={{ marginRight: 4 }} /> Create Shipment
                    </Button>
                  </Link>
                )}
              </div>
            </div>

            {/* Customer & Address Snapshot */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div
                style={{
                  padding: "12px",
                  border: "1px solid var(--color-border-subtle)",
                  borderRadius: "var(--radius-card)",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: "4px" }}>Customer Snapshot</div>
                <div>{selectedOrder.order.customer_name}</div>
                <div style={{ color: "var(--color-text-muted)" }}>{selectedOrder.order.customer_phone}</div>
              </div>
              <div
                style={{
                  padding: "12px",
                  border: "1px solid var(--color-border-subtle)",
                  borderRadius: "var(--radius-card)",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: "4px" }}>Delivery Address</div>
                <div>{selectedOrder.order.delivery_address?.address_line_1}</div>
                <div style={{ color: "var(--color-text-muted)" }}>
                  {selectedOrder.order.delivery_address?.district},{" "}
                  {selectedOrder.order.delivery_address?.division}
                </div>
              </div>
            </div>

            {/* Order Items Table */}
            <div>
              <div style={{ fontWeight: 600, marginBottom: "8px" }}>Ordered Items</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--color-border-subtle)", textAlign: "left" }}>
                    <th style={{ padding: "8px 6px" }}>Item</th>
                    <th style={{ padding: "8px 6px" }}>Qty</th>
                    <th style={{ padding: "8px 6px" }}>Price</th>
                    <th style={{ padding: "8px 6px", textAlign: "right" }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedOrder.order.items || []).map((item: any) => (
                    <tr key={item.id} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
                      <td style={{ padding: "8px 6px" }}>
                        <strong>{item.title_snapshot}</strong> ({item.variant_title_snapshot})
                      </td>
                      <td style={{ padding: "8px 6px" }}>{item.quantity}</td>
                      <td style={{ padding: "8px 6px" }}>{item.unit_price} ৳</td>
                      <td style={{ padding: "8px 6px", textAlign: "right", fontWeight: 600 }}>
                        {item.total_price} ৳
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Financial Totals */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                alignItems: "flex-end",
                paddingTop: "8px",
                borderTop: "1px solid var(--color-border-subtle)",
              }}
            >
              <div>Subtotal: {selectedOrder.order.subtotal?.toLocaleString("en-BD")} ৳</div>
              <div>Shipping: {selectedOrder.order.shipping_total?.toLocaleString("en-BD")} ৳</div>
              {selectedOrder.order.discount_total > 0 && (
                <div style={{ color: "var(--color-success)" }}>
                  Discount: -{selectedOrder.order.discount_total?.toLocaleString("en-BD")} ৳
                </div>
              )}
              <div style={{ fontSize: "16px", fontWeight: 700, marginTop: "4px" }}>
                Grand Total: {selectedOrder.order.grand_total?.toLocaleString("en-BD")} ৳
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
