"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Cpu,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Play,
  Check,
  X,
  ExternalLink,
  Shield,
  Layers,
  ArrowRightLeft,
  PlugZap,
  Settings,
  ArrowRight,
} from "lucide-react";
import styles from "../enterprise.module.css";
import { EnterpriseNav } from "../components/EnterpriseNav";
import { IntegrationProvider, IntegrationInstallation, IntegrationConflict, IntegrationSyncRecord } from "@/types/enterprise";

export default function EnterpriseIntegrationsPage() {
  const [providers, setProviders] = useState<IntegrationProvider[]>([]);
  const [installed, setInstalled] = useState<IntegrationInstallation[]>([]);
  const [conflicts, setConflicts] = useState<IntegrationConflict[]>([]);
  const [recentSyncs, setRecentSyncs] = useState<IntegrationSyncRecord[]>([]);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchIntegrations = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/v1/enterprise/integrations");
      const json = await res.json();
      setProviders(json.data?.providers || []);
      setInstalled(json.data?.installed || []);
      setRecentSyncs(json.data?.recent_syncs || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIntegrations();
  }, []);

  const handleTestConnection = async (id: string) => {
    try {
      setTestingId(id);
      setMessage(null);
      const res = await fetch(`/api/v1/enterprise/integrations/${id}/test`, { method: "POST" });
      const json = await res.json();
      if (json.data?.success) {
        setMessage(`Connector test passed${typeof json.data.latency_ms === "number" ? ` (${json.data.latency_ms}ms latency)` : ""}`);
      } else if (json.data?.status === "SIMULATED") {
        setMessage(`Not verified: ${json.data.message}`);
      } else {
        setMessage(`Connector test error: ${json.data?.message || json.error?.message || "Failed"}`);
      }
    } catch {
      setMessage("Error testing connection");
    } finally {
      setTestingId(null);
    }
  };

  const handleTriggerSync = async (id: string) => {
    try {
      setSyncingId(id);
      setMessage(null);
      const res = await fetch(`/api/v1/enterprise/integrations/${id}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_type: "ORDER" }),
      });
      const json = await res.json();
      // The sync endpoint refuses (424) until provider adapters exist; show its message instead of "success" (FX-31)
      setMessage(res.ok ? `Sync finished: ${json.data?.records_processed ?? 0} records processed` : `Sync not run: ${json.error?.message || "failed"}`);
      fetchIntegrations();
    } catch {
      setMessage("Error triggering sync");
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h1>
            <Cpu size={28} color="#c7f900" />
            Enterprise Integration Hub & Connectors
            <span className={styles.headerBadge}>Phase 9</span>
          </h1>
          <p className={styles.headerSubtitle}>
            Bidirectional sync engines for ERP, CRM, marketplaces, and accounting systems with conflict governance
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link href="/connector?category=ENTERPRISE" className={styles.btnPrimary}>
            <PlugZap size={14} />
            <span>Open in Connector Hub</span>
            <ArrowRight size={14} />
          </Link>
          <button className={styles.btnSecondary} onClick={fetchIntegrations}>
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <EnterpriseNav />

      {/* Migration Notice Banner */}
      <div
        style={{
          padding: "16px 20px",
          borderRadius: 14,
          marginBottom: 24,
          background: "rgba(199, 249, 0, 0.06)",
          border: "1px solid rgba(199, 249, 0, 0.25)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: "rgba(199, 249, 0, 0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#c7f900",
              flexShrink: 0,
            }}
          >
            <PlugZap size={20} />
          </div>
          <div>
            <div style={{ fontWeight: 700, color: "#ffffff", fontSize: 14, marginBottom: 2 }}>
              Enterprise Connectors Unified in Connector Hub
            </div>
            <div style={{ fontSize: 13, color: "#9ca3af", maxWidth: 780, lineHeight: 1.4 }}>
              All ERP, CRM, and Marketplace pipelines have moved into the unified Connectors & Server Hub. Configure SAP S/4HANA, NetSuite, Salesforce, HubSpot, Daraz, and Shopify Plus with live AES-256-GCM encryption, interactive test handshakes, and step-by-step setup guides.
            </div>
          </div>
        </div>

        <Link
          href="/connector?category=ENTERPRISE"
          className={styles.btnPrimary}
          style={{ padding: "8px 16px", fontSize: 13 }}
        >
          <PlugZap size={14} />
          <span>Configure in Connector Hub</span>
          <ArrowRight size={14} />
        </Link>
      </div>

      {message && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 8,
            marginBottom: 20,
            background: "rgba(199, 249, 0, 0.1)",
            border: "1px solid rgba(199, 249, 0, 0.3)",
            color: "#c7f900",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
          }}
        >
          <CheckCircle2 size={16} />
          {message}
        </div>
      )}

      {/* Installed Connectors Bento */}
      <div className={styles.bentoGrid}>
        <div className={`${styles.col12} ${styles.card}`}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>
              <ArrowRightLeft size={18} color="#c7f900" />
              Connected Enterprise Systems ({installed.length})
            </div>
          </div>

          {installed.length === 0 ? (
            <div
              style={{
                padding: "32px 20px",
                textAlign: "center",
                background: "rgba(255,255,255,0.02)",
                borderRadius: 12,
                border: "1px dashed rgba(255,255,255,0.08)",
              }}
            >
              <PlugZap size={32} style={{ color: "#c7f900", margin: "0 auto 12px", opacity: 0.8 }} />
              <div style={{ fontSize: 15, fontWeight: 700, color: "#ffffff", marginBottom: 6 }}>
                No Enterprise Systems Connected Yet
              </div>
              <p style={{ fontSize: 13, color: "#9ca3af", maxWidth: 500, margin: "0 auto 16px" }}>
                Connect your SAP S/4HANA, NetSuite, Salesforce, HubSpot, Daraz, or Shopify Plus instances in the Connector Hub to enable bidirectional sync.
              </p>
              <Link href="/connector?category=ENTERPRISE" className={styles.btnPrimary}>
                <PlugZap size={14} />
                <span>Connect an Enterprise System</span>
              </Link>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
              {installed.map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: 16,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 12,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontWeight: 700, color: "#ffffff", fontSize: 14 }}>{item.provider_name}</span>
                    <span className={item.status === "HEALTHY" ? styles.badgeHealthy : item.status === "NOT_VERIFIED" || item.status === "DEGRADED" ? styles.badgeDegraded : styles.badgeCritical}>
                      {item.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 12 }}>
                    Category: <span style={{ color: "#c7f900" }}>{item.category}</span> • Frequency: {item.sync_frequency_minutes}m
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Link
                      href={`/connector?category=ENTERPRISE&provider=${item.provider_id}`}
                      className={styles.btnSecondary}
                      style={{ fontSize: 12, padding: "6px 12px" }}
                    >
                      <Settings size={12} />
                      Configure
                    </Link>
                    <button
                      className={styles.btnSecondary}
                      onClick={() => handleTestConnection(item.id)}
                      disabled={testingId === item.id}
                      style={{ fontSize: 12, padding: "6px 12px" }}
                    >
                      {testingId === item.id ? "Testing..." : "Test Link"}
                    </button>
                    <button
                      className={styles.btnPrimary}
                      onClick={() => handleTriggerSync(item.id)}
                      disabled={syncingId === item.id}
                      style={{ fontSize: 12, padding: "6px 12px" }}
                    >
                      <Play size={12} />
                      {syncingId === item.id ? "Syncing..." : "Sync Now"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Available Integration Catalog */}
      <div className={styles.bentoGrid}>
        <div className={`${styles.col12} ${styles.card}`}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>
              <Layers size={18} color="#c7f900" />
              Available Certified Connectors ({providers.length})
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
            {providers.map((p) => (
              <div
                key={p.id}
                style={{
                  padding: 18,
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 12,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontWeight: 700, color: "#ffffff", fontSize: 14 }}>{p.name}</span>
                    <span style={{ fontSize: 10, color: "#c7f900", background: "rgba(199,249,0,0.1)", padding: "2px 6px", borderRadius: 4 }}>
                      {p.category}
                    </span>
                  </div>
                  <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 12, lineHeight: 1.4 }}>{p.description}</p>
                  <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 14 }}>
                    Auth: {p.auth_type} • Entities: {p.supported_entities.join(", ")}
                  </div>
                </div>

                <Link
                  href={`/connector?category=ENTERPRISE&provider=${p.id}`}
                  className={styles.btnPrimary}
                  style={{
                    width: "100%",
                    justifyContent: "center",
                    fontSize: "12px",
                    padding: "8px 12px",
                  }}
                >
                  <PlugZap size={13} />
                  <span>Configure in Connector Hub</span>
                  <ArrowRight size={13} />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
