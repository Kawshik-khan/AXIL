"use client";

import React, { useEffect, useState } from "react";
import {
  Code2,
  Key,
  Webhook,
  Plus,
  RefreshCw,
  Copy,
  Check,
  Shield,
  FileCode,
  CheckCircle2,
} from "lucide-react";
import styles from "../enterprise.module.css";
import { EnterpriseNav } from "../components/EnterpriseNav";
import { APIKeyRecord, DeveloperApplication, EnterpriseWebhookSubscription } from "@/types/enterprise";

export default function EnterpriseDeveloperPage() {
  const [apiKeys, setApiKeys] = useState<APIKeyRecord[]>([]);
  const [apps, setApps] = useState<DeveloperApplication[]>([]);
  const [webhooks, setWebhooks] = useState<EnterpriseWebhookSubscription[]>([]);
  const [showNewKey, setShowNewKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchDeveloperState = async () => {
    try {
      setLoading(true);
      const [devRes, webRes] = await Promise.all([
        fetch("/api/v1/enterprise/developer"),
        fetch("/api/v1/enterprise/webhooks"),
      ]);

      const [devData, webData] = await Promise.all([devRes.json(), webRes.json()]);
      setApiKeys(devData.data?.api_keys || []);
      setApps(devData.data?.applications || []);
      setWebhooks(webData.data?.webhooks || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeveloperState();
  }, []);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName) return;

    try {
      const res = await fetch("/api/v1/enterprise/developer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName }),
      });
      const json = await res.json();
      setGeneratedKey(json.data?.rawApiKey || json.data?.raw_key);
      setNewKeyName("");
      setShowNewKey(false);
      fetchDeveloperState();
    } catch (err) {
      console.error(err);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h1>
            <Code2 size={28} color="#c7f900" />
            Developer Platform & API Governance
            <span className={styles.headerBadge}>Phase 9</span>
          </h1>
          <p className={styles.headerSubtitle}>
            Manage organizational API keys, webhook subscriptions, and external developer applications
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={fetchDeveloperState}>
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>
          <button className={styles.btnPrimary} onClick={() => setShowNewKey(!showNewKey)}>
            <Plus size={14} />
            <span>Generate Key</span>
          </button>
        </div>
      </div>

      <EnterpriseNav />

      {generatedKey && (
        <div
          className={styles.card}
          style={{
            marginBottom: 24,
            background: "rgba(199, 249, 0, 0.08)",
            border: "1px solid rgba(199, 249, 0, 0.4)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#c7f900" }}>
              New Enterprise API Key Created — Save this key now. It will not be shown again.
            </span>
            <button
              className={styles.btnSecondary}
              onClick={() => copyToClipboard(generatedKey)}
              style={{ fontSize: 12, padding: "4px 10px" }}
            >
              {copied ? <Check size={14} color="#c7f900" /> : <Copy size={14} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>
          <div className={styles.codeBlock}>{generatedKey}</div>
        </div>
      )}

      {showNewKey && (
        <div className={styles.card} style={{ marginBottom: 24 }}>
          <div className={styles.cardTitle} style={{ marginBottom: 12 }}>
            <Key size={18} color="#c7f900" /> Generate New API Key
          </div>
          <form onSubmit={handleCreateKey} style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>Key Name</label>
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g. Production ERP Integration Key"
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
            <button type="submit" className={styles.btnPrimary}>
              Generate Secret
            </button>
            <button type="button" className={styles.btnSecondary} onClick={() => setShowNewKey(false)}>
              Cancel
            </button>
          </form>
        </div>
      )}

      {/* Active Keys & Webhooks Grid */}
      <div className={styles.bentoGrid}>
        {/* API Keys (6 cols) */}
        <div className={`${styles.col6} ${styles.card}`}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>
              <Key size={18} color="#c7f900" />
              Active Enterprise API Keys ({apiKeys.length})
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {apiKeys.map((k) => (
              <div
                key={k.id}
                style={{
                  padding: 14,
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, color: "#ffffff", fontSize: 13 }}>{k.name}</span>
                  <span className={styles.badgeHealthy}>{k.status}</span>
                </div>
                <div style={{ fontFamily: "monospace", fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>
                  Prefix: <span style={{ color: "#c7f900" }}>{k.key_prefix}***</span> • Scopes ({k.scopes.length})
                </div>
                <div style={{ fontSize: 11, color: "#6b7280" }}>
                  Allowed Scopes: {k.scopes.join(", ")}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Webhooks (6 cols) */}
        <div className={`${styles.col6} ${styles.card}`}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>
              <Webhook size={18} color="#c7f900" />
              Webhook Subscriptions ({webhooks.length})
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {webhooks.length > 0 ? (
              webhooks.map((w) => (
                <div
                  key={w.id}
                  style={{
                    padding: 14,
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 10,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, color: "#ffffff", fontSize: 12, fontFamily: "monospace" }}>
                      {w.target_url}
                    </span>
                    <span className={styles.badgeHealthy}>{w.status}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>
                    Subscribed events: {w.event_types.join(", ")}
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.emptyState} style={{ padding: "24px 0" }}>
                <p style={{ fontSize: 13 }}>No active webhook subscriptions.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Code Example: cURL & SDK */}
      <div className={styles.bentoGrid}>
        <div className={`${styles.col12} ${styles.card}`}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>
              <FileCode size={18} color="#c7f900" />
              Developer Quickstart & API Authentication
            </div>
          </div>
          <p style={{ fontSize: 13, color: "#9ca3af", marginBottom: 12 }}>
            Pass your generated API key in the <code style={{ color: "#c7f900" }}>Authorization: Bearer &lt;key&gt;</code> header to query multi-store data:
          </p>
          <div className={styles.codeBlock}>
{`curl -X GET "https://api.commerceos.io/v1/enterprise/overview" \\
  -H "Authorization: Bearer cos_live_sec_9942a..." \\
  -H "X-Organization-ID: org_default"`}
          </div>
        </div>
      </div>
    </div>
  );
}
