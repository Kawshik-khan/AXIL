"use client";

import React, { useEffect, useState } from "react";
import {
  Boxes,
  Plus,
  AlertTriangle,
  ArrowUpDown,
  Warehouse as WarehouseIcon,
  CheckCircle2,
  AlertCircle,
  History,
} from "lucide-react";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { Input } from "@/components/ui/Input/Input";
import { Modal } from "@/components/ui/Modal/Modal";
import { Badge } from "@/components/ui/Badge/Badge";
import { EmptyState, LoadingState } from "@/components/ui/States/States";
import { StockMovementType } from "@/types/commerce";

interface InventoryItemView {
  id: string;
  warehouse_id: string;
  product_variant_id: string;
  product_name: string;
  sku: string;
  variant_title: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
  reorder_point: number;
  updated_at: string;
}

interface WarehouseOption {
  id: string;
  name: string;
  code: string;
}

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItemView[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // Adjustment form fields
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");
  const [adjustmentType, setAdjustmentType] = useState<StockMovementType>("PURCHASE");
  const [quantityDelta, setQuantityDelta] = useState("5");
  const [reason, setReason] = useState("");

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [invRes, whRes] = await Promise.all([
        fetch(`/api/v1/inventory?low_stock_only=${lowStockOnly}`),
        fetch("/api/v1/warehouses"),
      ]);

      if (invRes.ok) {
        const invJson = await invRes.json();
        setItems(invJson.data?.inventory || []);
      }
      if (whRes.ok) {
        const whJson = await whRes.json();
        const whList = whJson.data?.warehouses || [];
        setWarehouses(whList);
        if (whList.length > 0 && !selectedWarehouseId) {
          setSelectedWarehouseId(whList[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to load inventory:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [lowStockOnly]);

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!selectedVariantId) {
      setFormError("Please select a product variant.");
      return;
    }
    if (!selectedWarehouseId) {
      setFormError("Please select a warehouse.");
      return;
    }
    const delta = parseInt(quantityDelta, 10);
    if (isNaN(delta) || delta === 0) {
      setFormError("Delta must be a non-zero number.");
      return;
    }
    if (!reason.trim()) {
      setFormError("A mandatory audit reason is required.");
      return;
    }

    // Auto calculate sign based on type if user entered positive
    let finalDelta = delta;
    if ((adjustmentType === "DAMAGE" || adjustmentType === "TRANSFER_OUT") && delta > 0) {
      finalDelta = -delta;
    }

    try {
      setIsSubmitting(true);
      const res = await fetch("/api/v1/inventory/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouse_id: selectedWarehouseId,
          product_variant_id: selectedVariantId,
          quantity_delta: finalDelta,
          type: adjustmentType,
          reason: reason.trim(),
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error?.message || "Failed to adjust stock");
      }

      setIsModalOpen(false);
      setReason("");
      setQuantityDelta("5");
      await loadData();
    } catch (err: any) {
      setFormError(err.message || "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const lowStockCount = items.filter((i) => i.quantity_available <= i.reorder_point).length;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>Inventory &amp; Warehousing</h1>
          <p style={{ color: "var(--color-text-muted)", fontSize: "14px", marginTop: "4px" }}>
            Multi-warehouse stock reservation engine with concurrency and negative-stock protection.
          </p>
        </div>
        <Button variant="primary" size="md" onClick={() => setIsModalOpen(true)}>
          <ArrowUpDown size={16} style={{ marginRight: 6 }} /> Adjust Stock
        </Button>
      </div>

      {/* Low Stock Alert Banner */}
      {lowStockCount > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            background: "rgba(239, 68, 68, 0.08)",
            border: "1px solid rgba(239, 68, 68, 0.2)",
            borderRadius: "var(--radius-card)",
            marginBottom: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <AlertTriangle size={20} color="var(--color-danger)" />
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-danger)" }}>
              {lowStockCount} product variants are at or below reorder threshold. Replenishment recommended.
            </span>
          </div>
          <button
            onClick={() => setLowStockOnly(!lowStockOnly)}
            style={{
              fontSize: "12px",
              fontWeight: 600,
              background: "none",
              border: "none",
              textDecoration: "underline",
              color: "var(--color-danger)",
              cursor: "pointer",
            }}
          >
            {lowStockOnly ? "Show All Items" : "Filter Low Stock"}
          </button>
        </div>
      )}

      {/* Stock Table */}
      <BentoCard span={12} title="Stock Balances" subtitle={`Across ${warehouses.length} active warehouses`}>
        {isLoading ? (
          <LoadingState message="Calculating authoritative stock quantities..." />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Boxes size={36} color="var(--color-lime-hover)" />}
            title="No inventory records"
            description="Create products to automatically initialize stock tracking across warehouses."
            actionText="Go to Products"
            onAction={() => {
              window.location.href = "/products";
            }}
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border-subtle)", textAlign: "left" }}>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Product / Variant</th>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>SKU</th>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>On Hand</th>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Reserved</th>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Available</th>
                  <th style={{ padding: "12px 10px", color: "var(--color-text-secondary)" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const isLow = item.quantity_available <= item.reorder_point;
                  return (
                    <tr key={item.id} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
                      <td style={{ padding: "14px 10px", fontWeight: 600 }}>
                        <div>{item.product_name}</div>
                        <div style={{ fontSize: "11px", color: "var(--color-text-muted)", fontWeight: 400 }}>
                          {item.variant_title}
                        </div>
                      </td>
                      <td style={{ padding: "14px 10px" }}>
                        <code>{item.sku}</code>
                      </td>
                      <td style={{ padding: "14px 10px" }}>{item.quantity_on_hand}</td>
                      <td style={{ padding: "14px 10px", color: "var(--color-text-muted)" }}>
                        {item.quantity_reserved}
                      </td>
                      <td style={{ padding: "14px 10px", fontWeight: 700 }}>{item.quantity_available}</td>
                      <td style={{ padding: "14px 10px" }}>
                        <Badge variant={isLow ? "inactive" : "active"}>
                          {isLow ? "LOW STOCK" : "OPTIMAL"}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </BentoCard>

      {/* Adjust Stock Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Audit-Logged Stock Adjustment">
        <form onSubmit={handleAdjustStock} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
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
            <label style={{ fontSize: "13px", fontWeight: 500 }}>Target Product &amp; Variant *</label>
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
              <option value="">Select Variant...</option>
              {items.map((i) => (
                <option key={i.product_variant_id} value={i.product_variant_id}>
                  {i.product_name} ({i.variant_title}) — Avail: {i.quantity_available}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "13px", fontWeight: 500 }}>Warehouse *</label>
              <select
                value={selectedWarehouseId}
                onChange={(e) => setSelectedWarehouseId(e.target.value)}
                style={{
                  padding: "10px",
                  borderRadius: "var(--radius-control)",
                  border: "1px solid var(--color-border-subtle)",
                  fontFamily: "inherit",
                  fontSize: "13px",
                  background: "var(--color-bg-primary)",
                }}
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "13px", fontWeight: 500 }}>Movement Type *</label>
              <select
                value={adjustmentType}
                onChange={(e) => setAdjustmentType(e.target.value as StockMovementType)}
                style={{
                  padding: "10px",
                  borderRadius: "var(--radius-control)",
                  border: "1px solid var(--color-border-subtle)",
                  fontFamily: "inherit",
                  fontSize: "13px",
                  background: "var(--color-bg-primary)",
                }}
              >
                <option value="PURCHASE">PURCHASE (Supplier Stock-In)</option>
                <option value="ADJUSTMENT">ADJUSTMENT (Cycle Inventory Audit)</option>
                <option value="DAMAGE">DAMAGE (Damaged / Broken)</option>
                <option value="RETURN">RETURN (Customer Restock)</option>
                <option value="TRANSFER_OUT">TRANSFER_OUT (Inter-warehouse Out)</option>
                <option value="TRANSFER_IN">TRANSFER_IN (Inter-warehouse In)</option>
              </select>
            </div>
          </div>

          <Input
            label="Quantity Delta (+ or -) *"
            type="number"
            value={quantityDelta}
            onChange={(e) => setQuantityDelta(e.target.value)}
            required
            hint="Positive to increase stock, negative to decrease."
          />

          <Input
            label="Mandatory Audit Reason *"
            placeholder="e.g. Received PO-9012 from Gazipur Factory"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
          />

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
            <Button variant="outline" type="button" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={isSubmitting}>
              Submit Adjustment
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
