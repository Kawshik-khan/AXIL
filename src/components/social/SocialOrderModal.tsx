"use client";

import React, { useState, useEffect } from "react";
import { ShoppingBag, X, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button/Button";
import styles from "./SocialInbox.module.css";
import { DistrictPicker, useDeliveryFees } from "@/components/orders/DistrictPicker";
import type { InboxConversation, InboxOrderDraft } from "@/domains/social/conversations/inbox-queue";
import { takaOf } from "./inbox-view";

interface SocialOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversation: InboxConversation | null;
  /** The order the agent prepared: its items are fixed here, and the server prices them again. */
  draft?: InboxOrderDraft;
  /** The ticket the draft is on: the server resolves it with the order, and refuses a draft already handled. */
  draftTicketId?: string;
  onOrderCreated: (order: { order_number: string }) => void;
}

export const SocialOrderModal: React.FC<SocialOrderModalProps> = ({
  isOpen,
  onClose,
  conversation,
  draft,
  draftTicketId,
  onOrderCreated,
}) => {
  const [products, setProducts] = useState<any[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [district, setDistrict] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const deliveryFees = useDeliveryFees();
  const [addressLine, setAddressLine] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("COD");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const conversationId = conversation?.id;
  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg("");
    setAddressLine("");
    setCustomerPhone("");
    setQuantity(1);
    setDistrict(draft?.delivery_district ?? "");
    setPaymentMethod(draft?.payment_method ?? "COD");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the form starts over for each opening, not for each refresh of the chat
  }, [isOpen, conversationId]);

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/v1/products?limit=20")
      .then((res) => {
        if (!res.ok) throw new Error("The product list could not be loaded.");
        return res.json();
      })
      .then((data) => {
        if (data.data) {
          setProducts(data.data);
          // Set first available variant
          const firstVariant = data.data[0]?.variants?.[0];
          if (firstVariant) setSelectedVariantId(firstVariant.id);
        }
      })
      .catch(() => setErrorMsg("The product list could not be loaded. Close this form and try again."));
  }, [isOpen]);

  if (!isOpen || !conversation) return null;

  const customer = conversation.customer;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (!draft && !selectedVariantId) {
      setErrorMsg("Please select a product variant.");
      return;
    }
    if (!addressLine.trim()) {
      setErrorMsg("Delivery address line is required.");
      return;
    }
    if (!district) {
      setErrorMsg("Choose the delivery district.");
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await fetch("/api/v1/social/orders/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversation.id,
          items: draft ? draft.items.map((i) => ({ variant_id: i.variant_id, quantity: i.quantity })) : [{ variant_id: selectedVariantId, quantity }],
          delivery_address: {
            district,
            address_line_1: addressLine.trim(),
          },
          payment_method: paymentMethod,
          ...(draft?.coupon_code ? { coupon_code: draft.coupon_code } : {}),
          ...(draft && draftTicketId ? { escalation_id: draftTicketId } : {}),
          ...(customer?.phone ? {} : { customer_phone: customerPhone.trim() }),
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
              {draft ? "Review the order draft" : "Create order"}
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
              background: "var(--color-danger-bg)",
              border: "1px solid var(--color-danger)",
              color: "var(--color-danger-ink)",
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

          {draft && (
            <div style={{ fontSize: "0.8125rem", color: "var(--color-text-primary)" }}>
              {draft.items.map((item) => (
                <div key={item.variant_id} style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                  <span>
                    {item.quantity} × {item.product_name}
                  </span>
                  <span>{takaOf(item.line_total)}</span>
                </div>
              ))}
              <div style={{ marginTop: "4px", color: "var(--color-text-secondary)" }}>
                The agent&apos;s total was {takaOf(draft.grand_total)}. Prices and the delivery fee are worked out again when you confirm.
              </div>
            </div>
          )}

          {/* Product Variant Picker */}
          {!draft && <div>
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
          </div>}

          {/* Quantity */}
          {!draft && <div>
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
          </div>}

          {/* District decides the zone and charge; the fee comes from settings (FX-36, was a literal in this form) */}
          <DistrictPicker
            district={district}
            onChange={setDistrict}
            fees={deliveryFees}
            labelStyle={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text-muted)" }}
            selectStyle={{
              width: "100%",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "6px",
              padding: "8px 10px",
              color: "var(--color-text-primary)",
              fontSize: "0.8125rem",
            }}
          />

          {/* Phone, when the social customer has none on record (identity resolution no longer invents one) */}
          {!customer?.phone && (
            <div>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                Customer phone *
              </label>
              <input
                type="tel"
                placeholder="e.g. 01712345678"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                required
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
          )}

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
