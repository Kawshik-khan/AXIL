"use client";

import React, { useEffect, useState } from "react";
import {
  Truck,
  Plus,
  Search,
  CheckCircle2,
  Clock,
  ExternalLink,
  Package,
  AlertCircle,
  TrendingUp,
} from "lucide-react";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { Input } from "@/components/ui/Input/Input";
import { Modal } from "@/components/ui/Modal/Modal";
import { Badge } from "@/components/ui/Badge/Badge";
import { EmptyState, LoadingState } from "@/components/ui/States/States";
import { Shipment, CourierProviderName, DeliveryStatus } from "@/types/commerce";

export default function ShipmentsPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [courierFilter, setCourierFilter] = useState("ALL");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // Dispatch Form
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [courierProvider, setCourierProvider] = useState<CourierProviderName>("STEADFAST");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [shippingCost, setShippingCost] = useState("60");

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [shipRes, ordRes] = await Promise.all([
        fetch("/api/v1/shipments"),
        fetch("/api/v1/orders?status=READY_TO_SHIP"),
      ]);

      if (shipRes.ok) {
        const json = await shipRes.json();
        setShipments(json.data?.shipments || []);
      }
      if (ordRes.ok) {
        const oJson = await ordRes.json();
        setOrders(oJson.data || []);
      }
    } catch (err) {
      console.error("Failed to load shipments:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!selectedOrderId) {
      setFormError("Please select an order to dispatch.");
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await fetch("/api/v1/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: selectedOrderId,
          courier_provider: courierProvider,
          tracking_number: trackingNumber.trim() || undefined,
          // Empty means the order's own delivery charge (server side); no literal fee here
          ...(Number.isFinite(parseFloat(shippingCost)) ? { shipping_cost: parseFloat(shippingCost) } : {}),
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error?.message || "Failed to dispatch shipment");
      }

      setIsModalOpen(false);
      setSelectedOrderId("");
      setTrackingNumber("");
      await loadData();
    } catch (err: any) {
      setFormError(err.message || "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStatus = async (shipmentId: string, targetStatus: DeliveryStatus) => {
    try {
      const res = await fetch(`/api/v1/shipments/${shipmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: targetStatus }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        alert(`Error: ${errJson.error?.message || "Failed to update delivery status"}`);
        return;
      }

      await loadData();
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  const filteredShipments = shipments.filter(
    (s) => courierFilter === "ALL" || s.courier_provider === courierFilter
  );

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>Logistics &amp; Courier Dispatch</h1>
          <p style={{ color: "var(--color-text-muted)", fontSize: "14px", marginTop: "4px" }}>
            Automated courier parcel creation and tracking normalization (Pathao, Steadfast, RedX).
          </p>
        </div>
        <Button variant="primary" size="md" onClick={() => setIsModalOpen(true)}>
          <Plus size={16} style={{ marginRight: 6 }} /> Dispatch Shipment
        </Button>
      </div>

      {/* Courier Filter Tabs */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "20px" }}>
        {["ALL", "STEADFAST", "PATHAO", "REDX"].map((c) => (
          <button
            key={c}
            onClick={() => setCourierFilter(c)}
            style={{
              padding: "8px 14px",
              borderRadius: "var(--radius-control)",
              fontSize: "12px",
              fontWeight: 600,
              border: "1px solid var(--color-border-subtle)",
              background: courierFilter === c ? "var(--color-charcoal)" : "transparent",
              color: courierFilter === c ? "var(--color-lime)" : "var(--color-text-secondary)",
              cursor: "pointer",
            }}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Shipments Table */}
      <BentoCard span={12} title="Consignments" subtitle={`Tracking ${filteredShipments.length} parcels`}>
        {isLoading ? (
          <LoadingState message="Connecting to courier tracking nodes..." />
        ) : filteredShipments.length === 0 ? (
          <EmptyState
            icon={<Truck size={36} color="var(--color-lime-hover)" />}
            title="No shipments registered yet"
            description="When orders reach Ready to Ship, assign a courier to generate tracking numbers."
            actionText="+ Dispatch Shipment"
            onAction={() => setIsModalOpen(true)}
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border-subtle)", textAlign: "left" }}>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Tracking Number</th>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Courier</th>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Consignment ID</th>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Shipping Cost</th>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Status</th>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)", textAlign: "right" }}>
                    Advance Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredShipments.map((s) => (
                  <tr key={s.id} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
                    <td style={{ padding: "14px 10px", fontWeight: 700 }}>
                      <code>{s.tracking_number}</code>
                    </td>
                    <td style={{ padding: "14px 10px" }}>
                      <Badge variant="role">{s.courier_provider}</Badge>
                    </td>
                    <td style={{ padding: "14px 10px", color: "var(--color-text-muted)" }}>
                      {s.consignment_id || "—"}
                    </td>
                    <td style={{ padding: "14px 10px", fontWeight: 600 }}>{s.shipping_cost} ৳</td>
                    <td style={{ padding: "14px 10px" }}>
                      <Badge variant={s.status === "DELIVERED" ? "active" : "pending"}>
                        {s.status}
                      </Badge>
                    </td>
                    <td style={{ padding: "14px 10px", textAlign: "right" }}>
                      {s.status === "PENDING" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleUpdateStatus(s.id, "IN_TRANSIT")}
                        >
                          Mark In Transit
                        </Button>
                      )}
                      {s.status === "IN_TRANSIT" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleUpdateStatus(s.id, "OUT_FOR_DELIVERY")}
                        >
                          Out for Delivery
                        </Button>
                      )}
                      {s.status === "OUT_FOR_DELIVERY" && (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleUpdateStatus(s.id, "DELIVERED")}
                        >
                          Mark Delivered
                        </Button>
                      )}
                      {s.status === "DELIVERED" && (
                        <span style={{ fontSize: "12px", color: "var(--color-success)", fontWeight: 600 }}>
                          ✓ Delivered
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </BentoCard>

      {/* Dispatch Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Dispatch Parcel to Courier">
        <form onSubmit={handleDispatch} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
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

          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{ fontSize: "13px", fontWeight: 500 }}>Select Order to Dispatch *</label>
            <select
              value={selectedOrderId}
              onChange={(e) => setSelectedOrderId(e.target.value)}
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
              <option value="">Select Order...</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.order_number} — {o.customer_name} ({o.grand_total} ৳)
                </option>
              ))}
            </select>
            {orders.length === 0 && (
              <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                Note: Only orders in READY_TO_SHIP status appear here. Create an order or transition its status first.
              </span>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "13px", fontWeight: 500 }}>Courier Provider *</label>
              <select
                value={courierProvider}
                onChange={(e) => setCourierProvider(e.target.value as CourierProviderName)}
                style={{
                  padding: "10px",
                  borderRadius: "var(--radius-control)",
                  border: "1px solid var(--color-border-subtle)",
                  fontFamily: "inherit",
                  fontSize: "13px",
                  background: "var(--color-bg-primary)",
                }}
              >
                <option value="STEADFAST">Steadfast Courier</option>
                <option value="PATHAO">Pathao Parcel</option>
                <option value="REDX">RedX Logistics</option>
                <option value="IN_HOUSE">In-House Fleet</option>
              </select>
            </div>

            <Input
              label="Shipping Cost (BDT ৳)"
              type="number"
              value={shippingCost}
              onChange={(e) => setShippingCost(e.target.value)}
            />
          </div>

          <Input
            label="Custom Tracking / Consignment Number"
            placeholder="Leave empty to auto-generate"
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value)}
          />

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
            <Button variant="outline" type="button" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={isSubmitting}>
              Dispatch &amp; Generate Tracking
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
