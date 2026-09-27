"use client";

import React, { useState, useEffect } from "react";
import { ShoppingBag, X, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button/Button";
import styles from "./SocialInbox.module.css";

interface SocialOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversation: any;
  onOrderCreated: (order: any) => void;
}

export const SocialOrderModal: React.FC<SocialOrderModalProps> = ({
  isOpen,
  onClose,
  conversation,
  onOrderCreated,
}) => {
  const [products, setProducts] = useState<any[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [division, setDivision] = useState("Dhaka");
  const [district, setDistrict] = useState("Dhaka");
  const [addressLine, setAddressLine] = useState("");
  const [deliveryZone, setDeliveryZone] = useState<"INSIDE_DHAKA" | "OUTSIDE_DHAKA">("INSIDE_DHAKA");
  const [paymentMethod, setPaymentMethod] = useState("COD");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/v1/products?limit=20")
      .then((res) => res.json())
      .then((data) => {
        if (data.data) {
          setProducts(data.data);
          // Set first available variant
          const firstVariant = data.data[0]?.variants?.[0];
          if (firstVariant) setSelectedVariantId(firstVariant.id);
        }
      })
      .catch(() => {});
  }, [isOpen]);

  if (!isOpen || !conversation) return null;

  const customer = conversation.customer;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (!selectedVariantId) {
      setErrorMsg("Please select a product variant.");
      return;
    }
    if (!addressLine.trim()) {
      setErrorMsg("Delivery address line is required.");
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await fetch("/api/v1/social/orders/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversation.id,
          items: [{ variant_id: selectedVariantId, quantity }],
          delivery_address: {
            division,
            district,
            address_line_1: addressLine.trim(),
          },
          delivery_zone: deliveryZone,
          payment_method: paymentMethod,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Failed to create order");
      }

      onOrderCreated(data.data.order);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to create order");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <ShoppingBag size={20} color="var(--color-primary)" />
            <h3 style={{ fontSize: "1.125rem", fontWeight: 700, margin: 0, color: "var(--color-text-primary)" }}>
              Create Social Order
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: "var(--color-text-muted)", cursor: "pointer" }}
          >
            <X size={20} />
          </button>
        </div>

        {errorMsg && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: "6px",
              background: "rgba(239, 68, 68, 0.15)",
              border: "1px solid #EF4444",
              color: "#FCA5A5",
              fontSize: "0.8125rem",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <AlertCircle size={16} /> {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {/* Customer Snapshot */}
          <div
            style={{
              padding: "10px",
              borderRadius: "6px",
              background: "var(--color-surface-hover)",
              fontSize: "0.8125rem",
              color: "var(--color-text-secondary)",
            }}
          >
            Customer: <strong style={{ color: "var(--color-text-primary)" }}>{customer?.first_name} {customer?.last_name}</strong> • {customer?.phone}
          </div>

          {/* Product Variant Picker */}
          <div>
            <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
              Product & Variant
            </label>
            <select
              value={selectedVariantId}
              onChange={(e) => setSelectedVariantId(e.target.value)}
              style={{
                width: "100%",
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: "6px",
                padding: "8px 10px",
                color: "var(--color-text-primary)",
                fontSize: "0.8125rem",
              }}
            >
              {products.flatMap((p) =>
                (p.variants || []).map((v: any) => (
                  <option key={v.id} value={v.id}>
                    {p.name} — {v.title} (৳{v.price})
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Quantity */}
          <div>
            <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
              Quantity
            </label>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 1)}
              style={{
                width: "100%",
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: "6px",
                padding: "8px 10px",
                color: "var(--color-text-primary)",
                fontSize: "0.8125rem",
              }}
            />
          </div>

          {/* Delivery Zone & District */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                Delivery Zone
              </label>
              <select
                value={deliveryZone}
                onChange={(e) => {
                  const z = e.target.value as any;
                  setDeliveryZone(z);
                  if (z === "INSIDE_DHAKA") {
                    setDistrict("Dhaka");
                    setDivision("Dhaka");
                  } else {
                    setDistrict("Chittagong");
                    setDivision("Chittagong");
                  }
                }}
                style={{
                  width: "100%",
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "6px",
                  padding: "8px 10px",
                  color: "var(--color-text-primary)",
                  fontSize: "0.8125rem",
                }}
              >
                <option value="INSIDE_DHAKA">Inside Dhaka (৳60-70)</option>
                <option value="OUTSIDE_DHAKA">Outside Dhaka (৳120)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                District
              </label>
              <input
                type="text"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                style={{
                  width: "100%",
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "6px",
                  padding: "8px 10px",
                  color: "var(--color-text-primary)",
                  fontSize: "0.8125rem",
                }}
              />
            </div>
          </div>

          {/* Address Line 1 */}
          <div>
            <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
              Delivery Address (Road, House, Area)
            </label>
            <input
              type="text"
              placeholder="e.g. House 42, Road 11, Banani"
              value={addressLine}
              onChange={(e) => setAddressLine(e.target.value)}
              style={{
                width: "100%",
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: "6px",
                padding: "8px 10px",
                color: "var(--color-text-primary)",
                fontSize: "0.8125rem",
              }}
            />
          </div>

          {/* Payment Method */}
          <div>
            <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
              Payment Method
            </label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              style={{
                width: "100%",
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: "6px",
                padding: "8px 10px",
                color: "var(--color-text-primary)",
                fontSize: "0.8125rem",
              }}
            >
              <option value="COD">Cash on Delivery (COD)</option>
              <option value="BKASH">bKash</option>
              <option value="NAGAD">Nagad</option>
            </select>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" }}>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? "Creating Order..." : "Confirm & Create Order"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
