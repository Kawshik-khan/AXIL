"use client";

import React, { useEffect, useState } from "react";
import {
  GitBranch,
  Building2,
  Store,
  Tag,
  Plus,
  RefreshCw,
  Layers,
  CheckCircle2,
  AlertCircle,
  Globe,
  DollarSign,
} from "lucide-react";
import styles from "../enterprise.module.css";
import { EnterpriseNav } from "../components/EnterpriseNav";
import { Organization, BusinessUnit, EnterpriseBrand, EnterpriseStore } from "@/types/enterprise";

export default function EnterpriseHierarchyPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [businessUnits, setBusinessUnits] = useState<BusinessUnit[]>([]);
  const [brands, setBrands] = useState<EnterpriseBrand[]>([]);
  const [stores, setStores] = useState<EnterpriseStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddStore, setShowAddStore] = useState(false);
  const [newStoreName, setNewStoreName] = useState("");
  const [newStoreCode, setNewStoreCode] = useState("");
  const [newStoreChannel, setNewStoreChannel] = useState("ONLINE_STORE");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const fetchHierarchy = async () => {
    try {
      setLoading(true);
      const [orgRes, buRes, brandRes, storeRes] = await Promise.all([
        fetch("/api/v1/enterprise/organizations"),
        fetch("/api/v1/enterprise/business-units"),
        fetch("/api/v1/enterprise/brands"),
        fetch("/api/v1/enterprise/stores"),
      ]);

      const [orgData, buData, brandData, storeData] = await Promise.all([
        orgRes.json(),
        buRes.json(),
        brandRes.json(),
        storeRes.json(),
      ]);

      setOrganizations(orgData.data?.organizations || []);
      setBusinessUnits(buData.data?.business_units || []);
      setBrands(brandData.data?.brands || []);
      setStores(storeData.data?.stores || []);
    } catch {
      setMessage({ text: "Failed to load hierarchy data", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHierarchy();
  }, []);

  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStoreName || !newStoreCode) return;

    try {
      setCreating(true);
      const res = await fetch("/api/v1/enterprise/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: "org_default",
          name: newStoreName,
          code: newStoreCode.toUpperCase(),
          channel_type: newStoreChannel,
        }),
      });

      if (!res.ok) throw new Error("Failed to create store");
      setMessage({ text: `Store ${newStoreName} created successfully`, type: "success" });
      setNewStoreName("");
      setNewStoreCode("");
      setShowAddStore(false);
      fetchHierarchy();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Error creating store", type: "error" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h1>
            <GitBranch size={28} color="#c7f900" />
            Enterprise Hierarchy & Multi-Store Management
            <span className={styles.headerBadge}>Phase 9</span>
          </h1>
          <p className={styles.headerSubtitle}>
            Configure organizations, business units, multi-brand portfolios, and retail sales channels
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={fetchHierarchy}>
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>
          <button className={styles.btnPrimary} onClick={() => setShowAddStore(!showAddStore)}>
            <Plus size={14} />
            <span>Add Store</span>
          </button>
        </div>
      </div>

      <EnterpriseNav />

      {message && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 8,
            marginBottom: 20,
            background: message.type === "success" ? "rgba(199, 249, 0, 0.1)" : "rgba(239, 68, 68, 0.1)",
            border: `1px solid ${message.type === "success" ? "rgba(199, 249, 0, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
            color: message.type === "success" ? "#c7f900" : "#ef4444",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
          }}
        >
          {message.type === "success" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {message.text}
        </div>
      )}

      {showAddStore && (
        <div className={styles.card} style={{ marginBottom: 24, background: "rgba(36, 37, 41, 0.95)" }}>
          <div className={styles.cardTitle} style={{ marginBottom: 16 }}>
            <Store size={18} color="#c7f900" /> Provision New Enterprise Store Channel
          </div>
          <form onSubmit={handleCreateStore} style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr) auto", gap: 16, alignItems: "flex-end" }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>Store Name</label>
              <input
                type="text"
                value={newStoreName}
                onChange={(e) => setNewStoreName(e.target.value)}
                placeholder="e.g. Uttara Flagship Store"
                required
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  background: "#121316",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  color: "#ffffff",
                  fontSize: 13,
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>Store Code</label>
              <input
                type="text"
                value={newStoreCode}
                onChange={(e) => setNewStoreCode(e.target.value)}
                placeholder="e.g. STR-UTT-01"
                required
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  background: "#121316",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  color: "#ffffff",
                  fontSize: 13,
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>Channel Type</label>
              <select
                value={newStoreChannel}
                onChange={(e) => setNewStoreChannel(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  background: "#121316",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  color: "#ffffff",
                  fontSize: 13,
                }}
              >
                <option value="ONLINE_STORE">Online Website</option>
                <option value="PHYSICAL_RETAIL">Physical Retail Outlet</option>
                <option value="FACEBOOK_SHOP">Facebook Shop / F-commerce</option>
                <option value="WHATSAPP_STORE">WhatsApp Conversational Commerce</option>
                <option value="MARKETPLACE">Marketplace Store (Daraz/Amazon)</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className={styles.btnPrimary} disabled={creating}>
                {creating ? "Creating..." : "Save Store"}
              </button>
              <button type="button" className={styles.btnSecondary} onClick={() => setShowAddStore(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Topology Hierarchy Cards */}
      <div className={styles.bentoGrid}>
        {/* Business Units Column */}
        <div className={`${styles.col4} ${styles.card}`}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>
              <Layers size={18} color="#c7f900" />
              Business Units ({businessUnits.length})
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {businessUnits.map((bu) => (
              <div
                key={bu.id}
                style={{
                  padding: 14,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, color: "#ffffff", fontSize: 14 }}>{bu.name}</span>
                  <span style={{ fontFamily: "monospace", fontSize: 11, color: "#9ca3af" }}>{bu.code}</span>
                </div>
                <div style={{ fontSize: 12, color: "#9ca3af" }}>Leader: {bu.leader_user_id || "Unassigned"}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Brands Column */}
        <div className={`${styles.col4} ${styles.card}`}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>
              <Tag size={18} color="#c7f900" />
              Brands Portfolio ({brands.length})
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {brands.map((b) => (
              <div
                key={b.id}
                style={{
                  padding: 14,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, color: "#ffffff", fontSize: 14 }}>{b.name}</span>
                  <span className={styles.badgeHealthy}>{b.status}</span>
                </div>
                <div style={{ fontSize: 12, color: "#9ca3af" }}>Category: {b.primary_category} • {b.currency}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Stores Column */}
        <div className={`${styles.col4} ${styles.card}`}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>
              <Store size={18} color="#c7f900" />
              Store Channels ({stores.length})
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 420, overflowY: "auto" }}>
            {stores.map((s) => (
              <div
                key={s.id}
                style={{
                  padding: 14,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, color: "#ffffff", fontSize: 14 }}>{s.name}</span>
                  <span style={{ fontSize: 11, color: "#c7f900" }}>{s.currency}</span>
                </div>
                <div style={{ fontSize: 12, color: "#9ca3af", display: "flex", gap: 8 }}>
                  <span>{s.store_type}</span>
                  <span>•</span>
                  <span>{s.region} ({s.city})</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
