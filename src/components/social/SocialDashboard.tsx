"use client";

import React, { useState, useEffect } from "react";
import {
  Activity,
  MessageSquare,
  Users,
  Target,
  Clock,
  CheckCircle,
  AlertTriangle,
  Plus,
  RefreshCw,
  Zap,
  Globe,
  Radio,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/Button/Button";
import styles from "./SocialInbox.module.css";

export const SocialDashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<any>(null);
  const [channels, setChannels] = useState<any[]>([]);
  const [quickReplies, setQuickReplies] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showConnectModal, setShowConnectModal] = useState(false);

  // New Channel Form State
  const [channelType, setChannelType] = useState("FACEBOOK_MESSENGER");
  const [channelName, setChannelName] = useState("");
  const [providerAccountId, setProviderAccountId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [isSubmittingChannel, setIsSubmittingChannel] = useState(false);

  const fetchDashboardData = async () => {
    try {
      setIsLoading(true);
      const [mRes, chRes, qrRes] = await Promise.all([
        fetch("/api/v1/social/analytics"),
        fetch("/api/v1/social/channels"),
        fetch("/api/v1/social/quick-replies"),
      ]);

      const [mData, chData, qrData] = await Promise.all([
        mRes.json(),
        chRes.json(),
        qrRes.json(),
      ]);

      if (mData.data) setMetrics(mData.data.metrics);
      if (chData.data) setChannels(chData.data.channels);
      if (qrData.data) setQuickReplies(qrData.data.quickReplies);
    } catch {
      // Handle error gracefully
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const handleTestChannel = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/social/channels/${id}/test`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(`Channel test failed: ${data.error?.message || `HTTP ${res.status}`}`);
      } else if (data.data?.healthy) {
        alert("Channel connection verified.");
      } else if (data.data?.verified === false && data.data?.status !== "ERROR") {
        // Credentials have the right shape but no live check exists; inbound messages still arrive (FX-31)
        alert(`Not verified: ${data.data?.error || "live validation isn't implemented"}. The channel keeps receiving messages.`);
      } else {
        alert(`Channel test failed: ${data.data?.error || "Unknown error"}`);
      }
      fetchDashboardData();
    } catch {
      alert("Failed to test channel connection.");
    }
  };

  const handleConnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmittingChannel(true);
      const res = await fetch("/api/v1/social/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: channelType,
          name: channelName,
          provider_account_id: providerAccountId,
          credentials: {
            accessToken,
            appSecret,
          },
        }),
      });
      if (res.ok) {
        setShowConnectModal(false);
        setChannelName("");
        setProviderAccountId("");
        setAccessToken("");
        setAppSecret("");
        fetchDashboardData();
      } else {
        const err = await res.json();
        alert(`Failed to connect channel: ${err.error?.message || "Invalid credentials"}`);
      }
    } finally {
      setIsSubmittingChannel(false);
    }
  };

  if (isLoading && !metrics) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "var(--color-text-muted)" }}>
        Loading social analytics & channel telemetry...
      </div>
    );
  }

  const kpis = [
    { label: "Total Conversations", value: metrics?.totalConversations || 0, icon: <MessageSquare size={18} color="var(--color-primary)" /> },
    { label: "Unread Inquiries", value: metrics?.unreadConversations || 0, icon: <Radio size={18} color="#EF4444" /> },
    { label: "Active Open", value: metrics?.openConversations || 0, icon: <Clock size={18} color="#3B82F6" /> },
    { label: "Resolved", value: metrics?.resolvedConversations || 0, icon: <CheckCircle size={18} color="#22C55E" /> },
    { label: "Sales Leads", value: metrics?.totalLeads || 0, icon: <Target size={18} color="#F59E0B" /> },
    { label: "Messages Received Today", value: metrics?.messagesReceivedToday || 0, icon: <Activity size={18} color="var(--color-primary)" /> },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Top KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "14px" }}>
        {kpis.map((k, i) => (
          <div
            key={i}
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-lg)",
              padding: "16px",
              backdropFilter: "blur(12px)",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", fontWeight: 600 }}>
                {k.label}
              </span>
              {k.icon}
            </div>
            <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--color-text-primary)" }}>
              {k.value}
            </div>
          </div>
        ))}
      </div>

      {/* Channel Health Section */}
      <div
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)",
          padding: "20px",
          backdropFilter: "blur(12px)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div>
            <h3 style={{ fontSize: "1.125rem", fontWeight: 700, margin: 0, color: "var(--color-text-primary)" }}>
              Omnichannel Health & Connections
            </h3>
            <p style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)", margin: "4px 0 0" }}>
              Real-time webhook telemetry and connection health across social providers.
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <Button size="sm" variant="outline" onClick={fetchDashboardData}>
              <RefreshCw size={14} style={{ marginRight: "4px" }} /> Refresh
            </Button>
            <Button size="sm" variant="primary" onClick={() => setShowConnectModal(true)}>
              <Plus size={14} style={{ marginRight: "4px" }} /> Connect Channel
            </Button>
          </div>
        </div>

        {/* Channel Cards Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "14px" }}>
          {channels.length === 0 ? (
            <div style={{ padding: "20px", color: "var(--color-text-muted)", fontSize: "0.875rem" }}>
              No channels connected yet. Click "Connect Channel" to connect Facebook, Instagram, WhatsApp, or Website Chat.
            </div>
          ) : (
            channels.map((ch) => (
              <div
                key={ch.id}
                style={{
                  background: "var(--color-surface-hover)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "10px",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontWeight: 700, fontSize: "0.9375rem", color: "var(--color-text-primary)" }}>
                    {ch.name}
                  </div>
                  <span
                    style={{
                      fontSize: "0.6875rem",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      fontWeight: 700,
                      background: ch.status === "ACTIVE" ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)",
                      color: ch.status === "ACTIVE" ? "#22C55E" : "#EF4444",
                    }}
                  >
                    {ch.status}
                  </span>
                </div>

                <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                  Type: <strong>{ch.type}</strong> • ID: {ch.provider_account_id}
                </div>

                <div style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
                  Last Webhook: {ch.last_webhook_at ? new Date(ch.last_webhook_at).toLocaleTimeString() : "Pending traffic"}
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px", marginTop: "4px" }}>
                  <Button size="sm" variant="outline" onClick={() => handleTestChannel(ch.id)}>
                    Test Connection
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Connect Channel Modal */}
      {showConnectModal && (
        <div className={styles.modalOverlay} onClick={() => setShowConnectModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: "1.125rem", fontWeight: 700, margin: 0, color: "var(--color-text-primary)" }}>
              Connect Social Commerce Channel
            </h3>
            <p style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)", margin: 0 }}>
              Credentials are encrypted using AES-256-GCM and never exposed over client APIs.
            </p>

            <form onSubmit={handleConnectSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                  Channel Provider
                </label>
                <select
                  value={channelType}
                  onChange={(e) => setChannelType(e.target.value)}
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
                  <option value="FACEBOOK_MESSENGER">Facebook Messenger (Meta Page)</option>
                  <option value="INSTAGRAM">Instagram Direct Messages</option>
                  <option value="WHATSAPP">WhatsApp Business Cloud API</option>
                  <option value="WEBSITE_CHAT">Website Live Chat (First-Party)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                  Channel Display Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Official FB Page / Main WhatsApp"
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value)}
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

              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                  Provider Account ID (Page ID / Phone Number ID)
                </label>
                <input
                  type="text"
                  placeholder="e.g. 102938475610293"
                  value={providerAccountId}
                  onChange={(e) => setProviderAccountId(e.target.value)}
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

              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                  Access Token / API Key (Encrypted at Rest)
                </label>
                <input
                  type="password"
                  placeholder="EAABw..."
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
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

              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                  App Secret / Webhook Secret
                </label>
                <input
                  type="password"
                  placeholder="sec_..."
                  value={appSecret}
                  onChange={(e) => setAppSecret(e.target.value)}
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

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" }}>
                <Button type="button" variant="outline" onClick={() => setShowConnectModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={isSubmittingChannel}>
                  {isSubmittingChannel ? "Verifying..." : "Save & Verify"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
