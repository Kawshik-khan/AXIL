"use client";

import React, { useState, useEffect } from "react";
import {
  User,
  ShoppingBag,
  TrendingUp,
  Tag,
  Plus,
  Package,
  Truck,
  ExternalLink,
  Target,
  PanelRightClose,
} from "lucide-react";
import { Button } from "@/components/ui/Button/Button";
import styles from "./SocialInbox.module.css";

interface CustomerContextPanelProps {
  conversation: any;
  onOpenOrderModal: () => void;
  onOpenProductModal: () => void;
  onConvertLead: () => void;
  onAddTag: (tag: string) => void;
  onClose?: () => void;
}

export const CustomerContextPanel: React.FC<CustomerContextPanelProps> = ({
  conversation,
  onOpenOrderModal,
  onOpenProductModal,
  onConvertLead,
  onAddTag,
  onClose,
}) => {
  const [customerOrders, setCustomerOrders] = useState<any[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [newTagInput, setNewTagInput] = useState("");

  const customer = conversation?.customer;
  const loadedCustomerIdRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (!customer?.id) {
      loadedCustomerIdRef.current = null;
      setCustomerOrders([]);
      return;
    }
    if (loadedCustomerIdRef.current === customer.id) {
      return;
    }
    loadedCustomerIdRef.current = customer.id;

    setIsLoadingOrders(true);
    fetch(`/api/v1/orders?customer_id=${customer.id}&limit=5`)
      .then((res) => res.json())
      .then((data) => {
        if (data.data) {
          setCustomerOrders(data.data);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoadingOrders(false));
  }, [customer?.id]);

  if (!conversation || !customer) {
    return (
      <div className={styles.contextPanel}>
        <div className={styles.contextPanelHeader}>
          <div className={styles.contextHeaderTitle}>
            <User size={16} />
            <span>Customer Context</span>
          </div>
          {onClose && (
            <button
              type="button"
              className={styles.minimizeBtn}
              onClick={onClose}
              title="Minimize customer drawer"
            >
              <PanelRightClose size={15} />
              <span>Minimize</span>
            </button>
          )}
        </div>
        <div className={styles.contextCard}>
          <p style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
            Select a conversation to view customer identity and order history.
          </p>
        </div>
      </div>
    );
  }

  const handleAddTagSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTagInput.trim()) {
      onAddTag(newTagInput.trim());
      setNewTagInput("");
    }
  };

  return (
    <div className={styles.contextPanel}>
      {/* Top Drawer Header with Minimize Button */}
      <div className={styles.contextPanelHeader}>
        <div className={styles.contextHeaderTitle}>
          <User size={16} />
          <span>Customer & Commerce</span>
        </div>
        {onClose && (
          <button
            type="button"
            className={styles.minimizeBtn}
            onClick={onClose}
            title="Minimize customer drawer"
          >
            <PanelRightClose size={15} />
            <span>Minimize</span>
          </button>
        )}
      </div>

      {/* Customer Profile Card */}
      <div className={styles.contextCard}>
        <div className={styles.cardTitle}>
          <User size={16} /> Customer Profile
        </div>
        <div>
          <div style={{ fontSize: "1rem", fontWeight: 700, color: "#1F2937" }}>
            {customer.first_name} {customer.last_name}
          </div>
          <div style={{ fontSize: "0.8125rem", color: "#6B7280", marginTop: "2px" }}>
            📞 {customer.phone}
          </div>
          {customer.email && (
            <div style={{ fontSize: "0.8125rem", color: "#6B7280", marginTop: "2px" }}>
              ✉️ {customer.email}
            </div>
          )}
        </div>

        {/* Commerce Core Metrics */}
        <div className={styles.metricGrid}>
          <div className={styles.metricBox}>
            <div className={styles.metricLabel}>Total Orders</div>
            <div className={styles.metricValue}>{customer.total_orders || 0}</div>
          </div>
          <div className={styles.metricBox}>
            <div className={styles.metricLabel}>Total Spent</div>
            <div className={styles.metricValue}>৳{customer.total_spent || 0}</div>
          </div>
        </div>

        {/* Quick Actions */}
        <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
          <Button size="sm" variant="primary" onClick={onOpenOrderModal} style={{ flex: 1 }}>
            <ShoppingBag size={14} style={{ marginRight: "4px" }} /> Create Order
          </Button>
          <Button size="sm" variant="outline" onClick={onOpenProductModal} style={{ flex: 1 }}>
            <Package size={14} style={{ marginRight: "4px" }} /> Catalog
          </Button>
        </div>
      </div>

      {/* Tags Section */}
      <div className={styles.contextCard}>
        <div className={styles.cardTitle}>
          <Tag size={16} /> Conversation Tags
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {(conversation.tags || []).map((t: string) => (
            <span
              key={t}
              style={{
                fontSize: "0.6875rem",
                padding: "3px 8px",
                borderRadius: "6px",
                background: "rgba(199, 249, 0, 0.22)",
                color: "#1F2937",
                fontWeight: 700,
                border: "1px solid rgba(199, 249, 0, 0.5)",
              }}
            >
              #{t}
            </span>
          ))}
        </div>
        <form onSubmit={handleAddTagSubmit} style={{ display: "flex", gap: "6px" }}>
          <input
            type="text"
            placeholder="Add tag (e.g. VIP, WHOLESALE)..."
            value={newTagInput}
            onChange={(e) => setNewTagInput(e.target.value)}
            style={{
              flex: 1,
              background: "#FFFFFF",
              border: "1px solid rgba(30, 32, 30, 0.12)",
              borderRadius: "8px",
              padding: "6px 10px",
              fontSize: "0.75rem",
              color: "#1F2937",
              outline: "none",
            }}
          />
          <Button size="sm" variant="outline" type="submit">
            Add
          </Button>
        </form>
      </div>

      {/* Lead Capture Action */}
      <div className={styles.contextCard}>
        <div className={styles.cardTitle}>
          <Target size={16} /> Sales Lead
        </div>
        <p style={{ fontSize: "0.75rem", color: "#6B7280" }}>
          Capture high-intent inquiries directly into the sales pipeline.
        </p>
        <Button size="sm" variant="outline" onClick={onConvertLead}>
          <Target size={14} style={{ marginRight: "4px" }} /> Convert to Lead
        </Button>
      </div>

      {/* Canonical Order History */}
      <div className={styles.contextCard}>
        <div className={styles.cardTitle}>
          <ShoppingBag size={16} /> Recent Orders
        </div>
        {isLoadingOrders ? (
          <div style={{ fontSize: "0.75rem", color: "#6B7280" }}>Loading orders...</div>
        ) : customerOrders.length === 0 ? (
          <div style={{ fontSize: "0.75rem", color: "#6B7280" }}>No past orders found.</div>
        ) : (
          customerOrders.map((ord) => (
            <div key={ord.id} className={styles.orderItemSnippet}>
              <div>
                <div style={{ fontWeight: 700, color: "#1F2937" }}>
                  {ord.order_number}
                </div>
                <div style={{ fontSize: "0.6875rem", color: "#6B7280", marginTop: "2px" }}>
                  ৳{ord.grand_total} • {ord.status}
                </div>
              </div>
              <span
                style={{
                  fontSize: "0.625rem",
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: "6px",
                  background: ord.delivery_status === "DELIVERED" ? "rgba(16, 185, 129, 0.12)" : "rgba(30, 32, 30, 0.06)",
                  color: ord.delivery_status === "DELIVERED" ? "#059669" : "#4B5563",
                }}
              >
                {ord.delivery_status || ord.status}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
