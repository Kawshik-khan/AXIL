"use client";

import React, { useEffect, useState } from "react";
import {
  Megaphone,
  ShoppingCart,
  Users,
  Send,
  BarChart3,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ShieldCheck,
  ShieldAlert,
  ArrowUpRight,
  RefreshCw,
  Plus,
  Play,
  Check,
  X,
  Eye,
  Percent,
  MessageSquare,
  AlertCircle,
  Phone,
} from "lucide-react";
import styles from "./Marketing.module.css";
import { LoadingSkeleton, EmptyState, ErrorState } from "@/components/ui/States/States";

type TabKey = "overview" | "recovery" | "audiences" | "broadcasts" | "attribution";

export default function MarketingPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string>("");

  // Data states
  const [overview, setOverview] = useState<any>(null);
  const [carts, setCarts] = useState<any[]>([]);
  const [audiences, setAudiences] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [attribution, setAttribution] = useState<any>(null);
  const [attributionModel, setAttributionModel] = useState<string>("LAST_TOUCH");

  // Action states
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Modals
  const [selectedCohort, setSelectedCohort] = useState<any | null>(null);
  const [cohortMembers, setCohortMembers] = useState<any[]>([]);
  const [isCohortModalOpen, setIsCohortModalOpen] = useState(false);

  const [isNewCampaignModalOpen, setIsNewCampaignModalOpen] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [campaignAudienceId, setCampaignAudienceId] = useState("");
  const [campaignChannel, setCampaignChannel] = useState("WHATSAPP");
  const [campaignContent, setCampaignContent] = useState("");
  const [campaignBudget, setCampaignBudget] = useState("5000");

  const [selectedCartForPreview, setSelectedCartForPreview] = useState<any | null>(null);

  // Load all initial data
  const loadData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [overviewRes, cartsRes, audRes, cmpRes, attRes] = await Promise.all([
        fetch("/api/v1/marketing/overview"),
        fetch("/api/v1/marketing/abandoned-carts"),
        fetch("/api/v1/marketing/audiences"),
        fetch("/api/v1/marketing/broadcasts"),
        fetch(`/api/v1/marketing/attribution?model=${attributionModel}`),
      ]);

      if (!overviewRes.ok || !cartsRes.ok || !audRes.ok || !cmpRes.ok || !attRes.ok) {
        throw new Error("Failed to load marketing data from server");
      }

      const overviewJson = await overviewRes.json();
      const cartsJson = await cartsRes.json();
      const audJson = await audRes.json();
      const cmpJson = await cmpRes.json();
      const attJson = await attRes.json();

      setRequestId(overviewJson.meta?.request_id || "req_mkt_default");
      setOverview(overviewJson.data);
      setCarts(cartsJson.data?.carts || []);
      setAudiences(audJson.data?.audiences || []);
      setCampaigns(cmpJson.data?.campaigns || []);
      setAttribution(attJson.data);
    } catch (err: any) {
      console.error("Marketing load error:", err);
      setError(err.message || "Unable to communicate with Marketing API");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [attributionModel]);

  const showFeedback = (type: "success" | "error", text: string) => {
    setFeedbackMessage({ type, text });
    setTimeout(() => setFeedbackMessage(null), 5000);
  };

  // Trigger Recovery Nudge
  const handleSendNudge = async (cartId: string) => {
    setActionLoading(`nudge_${cartId}`);
    try {
      const res = await fetch(`/api/v1/marketing/abandoned-carts/${cartId}/nudge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || "Failed to dispatch WhatsApp nudge");
      }

      showFeedback("success", "✦ WhatsApp recovery nudge dispatched with verified live catalog pricing!");
      await loadData();
    } catch (err: any) {
      showFeedback("error", err.message);
    } finally {
      setActionLoading(null);
    }
  };

  // Mark Cart Recovered
  const handleMarkRecovered = async (cartId: string) => {
    setActionLoading(`rec_${cartId}`);
    try {
      const res = await fetch(`/api/v1/marketing/abandoned-carts/${cartId}/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: `ord_rec_${Date.now()}` }),
      });

      if (!res.ok) throw new Error("Failed to record recovery");
      showFeedback("success", "Cart successfully converted and attributed to WhatsApp recovery campaign!");
      await loadData();
    } catch (err: any) {
      showFeedback("error", err.message);
    } finally {
      setActionLoading(null);
    }
  };

  // Approve Campaign (Human Gate)
  const handleApproveCampaign = async (campaignId: string) => {
    setActionLoading(`appr_${campaignId}`);
    try {
      const res = await fetch(`/api/v1/marketing/broadcasts/${campaignId}/approve`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Approval gate execution failed");
      showFeedback("success", "Campaign approved by merchant. Ready for rate-limited broadcast.");
      await loadData();
    } catch (err: any) {
      showFeedback("error", err.message);
    } finally {
      setActionLoading(null);
    }
  };

  // Reject Campaign
  const handleRejectCampaign = async (campaignId: string) => {
    setActionLoading(`rej_${campaignId}`);
    try {
      const res = await fetch(`/api/v1/marketing/broadcasts/${campaignId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Campaign parameters rejected by operator." }),
      });
      if (!res.ok) throw new Error("Rejection failed");
      showFeedback("success", "Campaign rejected and cancelled.");
      await loadData();
    } catch (err: any) {
      showFeedback("error", err.message);
    } finally {
      setActionLoading(null);
    }
  };

  // Dispatch Campaign
  const handleDispatchCampaign = async (campaignId: string) => {
    setActionLoading(`disp_${campaignId}`);
    try {
      const res = await fetch(`/api/v1/marketing/broadcasts/${campaignId}/dispatch`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Dispatch failed");
      showFeedback("success", `Broadcast dispatched at 20 msgs/sec rate limit! Delivered: ${json.data.result?.messages_delivered || 0}`);
      await loadData();
    } catch (err: any) {
      showFeedback("error", err.message);
    } finally {
      setActionLoading(null);
    }
  };

  // Toggle Kill Switch
  const handleToggleKillSwitch = async () => {
    try {
      const currentState = overview?.kill_switch_active;
      const res = await fetch("/api/v1/marketing/broadcasts/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !currentState }),
      });
      if (!res.ok) throw new Error("Failed to toggle kill switch");
      showFeedback("success", !currentState ? "🚨 Emergency Kill Switch ENGAGED. Outbound messages paused." : "Emergency Kill Switch disengaged.");
      await loadData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  // Inspect Cohort Members
  const handleInspectCohort = async (cohort: any) => {
    setSelectedCohort(cohort);
    setIsCohortModalOpen(true);
    try {
      const res = await fetch(`/api/v1/marketing/audiences/${cohort.id}/members`);
      if (res.ok) {
        const json = await res.json();
        setCohortMembers(json.data.members || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Create Broadcast Campaign
  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!campaignName || !campaignAudienceId || !campaignContent) {
      showFeedback("error", "Please fill in all required campaign fields.");
      return;
    }

    try {
      setActionLoading("create_campaign");
      const res = await fetch("/api/v1/marketing/broadcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: campaignName,
          objective: "CONVERSION",
          audience_id: campaignAudienceId,
          channel: campaignChannel,
          content_body: campaignContent,
          call_to_action: "Shop Now",
          budget_bdt: Number(campaignBudget) || 0,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to create campaign");

      setIsNewCampaignModalOpen(false);
      setCampaignName("");
      setCampaignContent("");
      showFeedback("success", "Broadcast campaign created and evaluated with automated risk gating!");
      await loadData();
    } catch (err: any) {
      showFeedback("error", err.message);
    } finally {
      setActionLoading(null);
    }
  };

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.headerTitle}>
              <Megaphone size={28} color="var(--color-lime-primary, #C7F900)" /> Marketing & Campaigns
            </h1>
            <p className={styles.headerSubtitle}>Loading authoritative multi-tenant marketing state...</p>
          </div>
        </div>
        <LoadingSkeleton lines={6} height="320px" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <ErrorState
          title="Marketing Engine Error"
          message={error}
          requestId={requestId}
          onRetry={loadData}
        />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.headerTitle}>
            <Megaphone size={28} color="var(--color-lime-primary, #C7F900)" /> Marketing & Campaigns
          </h1>
          <p className={styles.headerSubtitle}>
            Phase 8 Advanced Agents: WhatsApp cart recovery, audience cohort segmentation, rate-limited broadcasts & multi-touch attribution
          </p>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.btnSecondary}
            onClick={loadData}
            title="Refresh state"
          >
            <RefreshCw size={15} /> Refresh
          </button>
          <button
            className={styles.btnPrimary}
            onClick={() => {
              if (audiences.length > 0) setCampaignAudienceId(audiences[0].id);
              setIsNewCampaignModalOpen(true);
            }}
          >
            <Plus size={16} /> New Broadcast Campaign
          </button>
        </div>
      </div>

      {/* Feedback Toast */}
      {feedbackMessage && (
        <div
          style={{
            padding: "12px 18px",
            borderRadius: "10px",
            marginBottom: "16px",
            fontSize: "13px",
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: feedbackMessage.type === "success" ? "#E8F5E9" : "#FFEBEE",
            color: feedbackMessage.type === "success" ? "#2E7D32" : "#C62828",
            border: `1px solid ${feedbackMessage.type === "success" ? "#A5D6A7" : "#FFCDD2"}`,
          }}
        >
          {feedbackMessage.type === "success" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          <span>{feedbackMessage.text}</span>
        </div>
      )}

      {/* Emergency Kill Switch Banner if Active */}
      {overview?.kill_switch_active && (
        <div className={styles.killSwitchBanner}>
          <div className={styles.killSwitchText}>
            <ShieldAlert size={20} />
            EMERGENCY BROADCAST KILL SWITCH IS ACTIVE: All outbound marketing dispatches are suspended.
          </div>
          <button className={styles.btnSecondary} onClick={handleToggleKillSwitch}>
            Disengage Kill Switch
          </button>
        </div>
      )}

      {/* Frosted Glass Segmented Pill Tabs */}
      <div className={styles.navTabs}>
        <button
          className={`${styles.navTab} ${activeTab === "overview" ? styles.navTabActive : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          <Sparkles size={16} /> ✦ Overview & Copilot
        </button>
        <button
          className={`${styles.navTab} ${activeTab === "recovery" ? styles.navTabActive : ""}`}
          onClick={() => setActiveTab("recovery")}
        >
          <ShoppingCart size={16} /> WhatsApp Cart Recovery ({carts.filter((c) => c.recovery_stage !== "RECOVERED").length})
        </button>
        <button
          className={`${styles.navTab} ${activeTab === "audiences" ? styles.navTabActive : ""}`}
          onClick={() => setActiveTab("audiences")}
        >
          <Users size={16} /> Audience Cohorts ({audiences.length})
        </button>
        <button
          className={`${styles.navTab} ${activeTab === "broadcasts" ? styles.navTabActive : ""}`}
          onClick={() => setActiveTab("broadcasts")}
        >
          <Send size={16} /> Broadcast Cockpit & Approvals {overview?.pending_approvals_count > 0 && `(✦ ${overview.pending_approvals_count} Pending)`}
        </button>
        <button
          className={`${styles.navTab} ${activeTab === "attribution" ? styles.navTabActive : ""}`}
          onClick={() => setActiveTab("attribution")}
        >
          <BarChart3 size={16} /> Revenue Attribution
        </button>
      </div>

      {/* TAB 1: OVERVIEW & COPILOT */}
      {activeTab === "overview" && (
        <>
          {/* Top 4 Bento KPI Cards */}
          <div className={styles.bentoGrid}>
            <div className={`${styles.bentoCard} ${styles.col3}`}>
              <div className={styles.cardHeader}>
                <span className={styles.cardTitle}>Attributed Revenue</span>

              </div>
              <div className={styles.cardBigValue}>৳{overview?.total_attributed_revenue_bdt?.toLocaleString() || "0"}</div>
              <div className={styles.cardMeta}>
                <span>Incremental lift: <strong>not measured</strong> (needs a control group)</span>
              </div>
            </div>

            <div className={`${styles.bentoCard} ${styles.col3} ${styles.aiCard}`}>
              <div className={styles.cardHeader}>
                <span className={styles.cardTitle}>Cart recovery</span>
                <span className={`${styles.trendBadge} ${styles.trendPositive}`}>
                  <CheckCircle2 size={12} /> {overview?.cart_recovery_rate_pct ?? 0}% of value recovered
                </span>
              </div>
              <div className={styles.cardBigValue}>৳{overview?.total_recovered_revenue_bdt?.toLocaleString() || "0"}</div>
              <div className={styles.cardMeta}>
                <span><strong>{overview?.active_abandoned_carts_count || 0}</strong> active carts awaiting recovery</span>
              </div>
            </div>

            <div className={`${styles.bentoCard} ${styles.col3}`}>
              <div className={styles.cardHeader}>
                <span className={styles.cardTitle}>Broadcasts (20 msg/s)</span>
                <span className={`${styles.trendBadge} ${styles.trendNeutral}`}>
                  WhatsApp Capped
                </span>
              </div>
              <div className={styles.cardBigValue}>{overview?.active_campaigns_count || 0} Active</div>
              <div className={styles.cardMeta}>
                <span>Zero rate-limit violations • Opt-out enforced</span>
              </div>
            </div>

            <div className={`${styles.bentoCard} ${styles.col3}`}>
              <div className={styles.cardHeader}>
                <span className={styles.cardTitle}>Human Approval Gate</span>
                {overview?.pending_approvals_count > 0 ? (
                  <span className={`${styles.trendBadge} ${styles.trendWarning}`}>
                    <AlertTriangle size={12} /> Needs Review
                  </span>
                ) : (
                  <span className={`${styles.trendBadge} ${styles.trendPositive}`}>
                    <Check size={12} /> In Policy
                  </span>
                )}
              </div>
              <div className={styles.cardBigValue}>{overview?.pending_approvals_count || 0} Pending</div>
              <div className={styles.cardMeta}>
                <span>Mandatory gate for &gt;50 recipients or budget &gt;৳5k</span>
              </div>
            </div>
          </div>

          {/* AI Marketing Agent Copilot & Quick Insights */}
          <div className={styles.bentoGrid}>
            <div className={`${styles.bentoCard} ${styles.col8} ${styles.aiCard}`}>
              <div className={styles.cardHeader}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <Sparkles size={20} color="#657e00" />
                  <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary, #202124)" }}>
                    ✦ Marketing Agent Autonomous Insights & Safeguards
                  </span>
                </div>
                <span className={styles.groundingPill}>
                  <ShieldCheck size={13} /> Commerce Core Grounded
                </span>
              </div>
              <p style={{ fontSize: "13px", color: "var(--color-text-secondary, #70736F)", marginBottom: "16px" }}>
                AI-driven analysis operating strictly under zero-tolerance factuality controls. No hallucinatory pricing, fake scarcity, or deceptive discounts.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {overview?.insights?.map((ins: any) => (
                  <div
                    key={ins.id}
                    style={{
                      padding: "14px",
                      background: "#FFFFFF",
                      borderRadius: "12px",
                      border: "1px solid var(--color-border-subtle, rgba(0,0,0,0.06))",
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "12px",
                    }}
                  >
                    <div style={{ marginTop: "2px" }}>
                      {ins.severity === "HIGH" ? (
                        <AlertTriangle size={18} color="#C62828" />
                      ) : ins.severity === "MEDIUM" ? (
                        <Clock size={18} color="#E65100" />
                      ) : (
                        <CheckCircle2 size={18} color="#2E7D32" />
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary, #202124)" }}>
                        {ins.title}
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--color-text-secondary, #70736F)", marginTop: "3px", lineHeight: "1.4" }}>
                        {ins.summary}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Action Dock */}
            <div className={`${styles.bentoCard} ${styles.col4}`}>
              <div className={styles.cardHeader}>
                <span className={styles.cardTitle}>Quick Operations</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "8px" }}>
                <button
                  className={styles.btnSecondary}
                  style={{ justifyContent: "flex-start", padding: "12px" }}
                  onClick={() => setActiveTab("recovery")}
                >
                  <ShoppingCart size={16} /> Review Abandoned Carts
                </button>
                <button
                  className={styles.btnSecondary}
                  style={{ justifyContent: "flex-start", padding: "12px" }}
                  onClick={() => setActiveTab("audiences")}
                >
                  <Users size={16} /> Inspect VIP & Dormant Cohorts
                </button>
                <button
                  className={styles.btnSecondary}
                  style={{ justifyContent: "flex-start", padding: "12px" }}
                  onClick={() => setActiveTab("broadcasts")}
                >
                  <Send size={16} /> Human Approval Cockpit
                </button>
                <button
                  className={styles.btnDanger}
                  style={{ justifyContent: "flex-start", padding: "12px" }}
                  onClick={handleToggleKillSwitch}
                >
                  <ShieldAlert size={16} /> {overview?.kill_switch_active ? "Resume Broadcast Dispatches" : "Emergency Kill Switch"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* TAB 2: WHATSAPP CART RECOVERY */}
      {activeTab === "recovery" && (
        <div className={styles.bentoGrid}>
          <div className={`${styles.bentoCard} ${styles.col12}`}>
            <div className={styles.cardHeader}>
              <div>
                <h3 style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary, #202124)" }}>
                  WhatsApp Abandoned Cart Recovery Sessions
                </h3>
                <p style={{ fontSize: "12px", color: "var(--color-text-secondary, #70736F)", marginTop: "2px" }}>
                  Automated nudges in culturally authentic Banglish with live stock & price validation. Anti-duplicate order protection enabled.
                </p>
              </div>
              <span className={styles.groundingPill}>
                <CheckCircle2 size={13} /> Max 1 Nudge / 24H per Customer
              </span>
            </div>

            {carts.length === 0 ? (
              <EmptyState
                title="No Abandoned Carts"
                description="All recent shopping cart sessions have either checked out or been recovered."
              />
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Items in Cart</th>
                      <th>Cart Total</th>
                      <th>Abandoned</th>
                      <th>Recovery Stage</th>
                      <th style={{ textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {carts.map((cart) => (
                      <tr key={cart.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{cart.customer ? `${cart.customer.first_name} ${cart.customer.last_name || ""}` : "Guest Customer"}</div>
                          <div style={{ fontSize: "11px", color: "var(--color-text-secondary, #70736F)", display: "flex", alignItems: "center", gap: "4px" }}>
                            <Phone size={10} /> {cart.customer?.phone || "No phone"}
                          </div>
                        </td>
                        <td>
                          {cart.cart_items.map((item: any, idx: number) => (
                            <div key={idx} style={{ fontSize: "12px" }}>
                              {item.title} <strong>× {item.quantity}</strong>
                            </div>
                          ))}
                        </td>
                        <td style={{ fontWeight: 700 }}>
                          {cart.formatted_total}
                        </td>
                        <td style={{ fontSize: "12px", color: "var(--color-text-secondary, #70736F)" }}>
                          {cart.time_ago}
                        </td>
                        <td>
                          <span
                            className={`${styles.statusPill} ${
                              cart.recovery_stage === "RECOVERED"
                                ? styles.statusRecovered
                                : cart.recovery_stage === "MESSAGED"
                                ? styles.statusMessaged
                                : styles.statusPending
                            }`}
                          >
                            {cart.recovery_stage}
                          </span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <div style={{ display: "inline-flex", gap: "6px" }}>
                            {cart.recovery_stage !== "RECOVERED" && (
                              <button
                                className={styles.btnPrimary}
                                style={{ padding: "6px 12px", fontSize: "12px" }}
                                onClick={() => handleSendNudge(cart.id)}
                                disabled={actionLoading === `nudge_${cart.id}`}
                              >
                                <MessageSquare size={13} /> {cart.recovery_stage === "MESSAGED" ? "Resend Nudge" : "Send WhatsApp Nudge"}
                              </button>
                            )}
                            {cart.recovery_stage !== "RECOVERED" && (
                              <button
                                className={styles.btnSecondary}
                                style={{ padding: "6px 12px", fontSize: "12px" }}
                                onClick={() => handleMarkRecovered(cart.id)}
                                disabled={actionLoading === `rec_${cart.id}`}
                              >
                                Mark Recovered
                              </button>
                            )}
                            {cart.recovery_stage === "RECOVERED" && (
                              <span style={{ fontSize: "12px", color: "#2E7D32", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                <CheckCircle2 size={14} /> Attributed to Order
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: AUDIENCE COHORTS */}
      {activeTab === "audiences" && (
        <div className={styles.bentoGrid}>
          {audiences.map((aud) => (
            <div key={aud.id} className={`${styles.bentoCard} ${styles.col6}`}>
              <div className={styles.cardHeader}>
                <div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary, #202124)" }}>
                    {aud.name}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--color-text-secondary, #70736F)", marginTop: "2px" }}>
                    {aud.description}
                  </div>
                </div>
                <span className={`${styles.statusPill} ${styles.statusApproved}`}>
                  {aud.type}
                </span>
              </div>

              <div style={{ margin: "16px 0", display: "flex", alignItems: "baseline", gap: "10px" }}>
                <div style={{ fontSize: "36px", fontWeight: 700, color: "var(--color-text-primary, #202124)" }}>
                  {aud.estimated_size}
                </div>
                <div style={{ fontSize: "13px", color: "var(--color-text-secondary, #70736F)" }}>
                  Active Recipients Matched
                </div>
              </div>

              {/* Segment Rules Summary */}
              <div style={{ background: "#FAFBF8", padding: "10px 14px", borderRadius: "10px", fontSize: "12px", color: "var(--color-text-secondary, #70736F)", marginBottom: "16px", border: "1px solid var(--color-border-subtle, rgba(0,0,0,0.06))" }}>
                <strong style={{ color: "var(--color-text-primary, #202124)" }}>Rule Logic: </strong>
                {aud.rule_groups.map((rg: any, idx: number) => (
                  <span key={idx}>
                    {rg.conditions.map((c: any) => `${c.field} ${c.operator} ${c.value}`).join(` ${rg.conjunction} `)}
                  </span>
                ))}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
                <span className={styles.groundingPill}>
                  <ShieldCheck size={12} /> Auto-Refreshed
                </span>
                <button
                  className={styles.btnSecondary}
                  onClick={() => handleInspectCohort(aud)}
                >
                  <Eye size={14} /> Inspect Cohort Members
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 4: BROADCAST COCKPIT & APPROVALS */}
      {activeTab === "broadcasts" && (
        <div className={styles.bentoGrid}>
          {/* Approval Safeguard Notice */}
          <div className={`${styles.bentoCard} ${styles.col12} ${styles.aiCard}`}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <ShieldCheck size={24} color="#657e00" />
                <div>
                  <div style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-text-primary, #202124)" }}>
                    Phase 8 Human-in-the-Loop Approval Safeguard Active
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--color-text-secondary, #70736F)" }}>
                    Broadcasting to &gt;50 customers, budget &gt;৳5,000, or discount &gt;15% requires explicit merchant approval. Outbound messages capped at 20 msgs/second.
                  </div>
                </div>
              </div>
              <button
                className={overview?.kill_switch_active ? styles.btnSecondary : styles.btnDanger}
                onClick={handleToggleKillSwitch}
              >
                <ShieldAlert size={14} /> {overview?.kill_switch_active ? "Disengage Kill Switch" : "Emergency Kill Switch"}
              </button>
            </div>
          </div>

          {/* Broadcasts List */}
          {campaigns.map((cmp) => (
            <div key={cmp.id} className={`${styles.bentoCard} ${styles.col6}`}>
              <div className={styles.cardHeader}>
                <div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary, #202124)" }}>
                    {cmp.name}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--color-text-secondary, #70736F)", marginTop: "2px" }}>
                    Channel: <strong>{cmp.channel}</strong> • Objective: {cmp.objective}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "6px" }}>
                  <span
                    className={`${styles.statusPill} ${
                      cmp.status === "APPROVED"
                        ? styles.statusApproved
                        : cmp.status === "REVIEW"
                        ? styles.statusReview
                        : cmp.status === "RUNNING"
                        ? styles.statusRunning
                        : styles.statusCompleted
                    }`}
                  >
                    {cmp.status}
                  </span>
                  <span
                    className={`${styles.statusPill} ${
                      cmp.risk_class === "HIGH"
                        ? styles.riskHigh
                        : cmp.risk_class === "MEDIUM"
                        ? styles.riskMedium
                        : styles.riskLow
                    }`}
                  >
                    {cmp.risk_class} RISK
                  </span>
                </div>
              </div>

              {/* Message Content Preview */}
              <div style={{ margin: "12px 0", padding: "12px", background: "#FAFBF8", borderRadius: "10px", border: "1px solid var(--color-border-subtle, rgba(0,0,0,0.06))", fontSize: "12px", lineHeight: "1.5" }}>
                <strong style={{ display: "block", marginBottom: "4px", color: "var(--color-text-secondary, #70736F)", fontSize: "11px", textTransform: "uppercase" }}>Copy Preview:</strong>
                {cmp.variants?.[0]?.content_body}
              </div>

              {/* Simulation metrics if present */}
              {cmp.simulation_snapshot && (
                <div style={{ marginBottom: "16px", padding: "10px 14px", background: "#FFFFFF", borderRadius: "8px", border: "1px solid var(--color-border-subtle, rgba(0,0,0,0.08))", display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                  <span>Est. Reach: <strong>{cmp.simulation_snapshot.estimated_reach}</strong></span>
                  <span>Exp. Conv: <strong>{cmp.simulation_snapshot.expected_conversion_rate}%</strong></span>
                  <span>
                    Exp. Revenue (simulated):{" "}
                    <strong>
                      {typeof cmp.simulation_snapshot.expected_revenue_bdt === "number"
                        ? `৳${cmp.simulation_snapshot.expected_revenue_bdt.toLocaleString()}`
                        : "not estimated"}
                    </strong>
                  </span>
                </div>
              )}

              {/* Execution result if completed */}
              {cmp.result_metrics && (
                <div style={{ marginBottom: "16px", padding: "10px 14px", background: "#E8F5E9", borderRadius: "8px", border: "1px solid #C8E6C9", display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#2E7D32" }}>
                  <span>Sent: <strong>{cmp.result_metrics.messages_sent}</strong></span>
                  <span>Delivered: <strong>{cmp.result_metrics.messages_delivered}</strong></span>
                  <span>Failed: <strong>{cmp.result_metrics.messages_failed}</strong></span>
                  <span>
                    Attributed GMV:{" "}
                    <strong>
                      {typeof cmp.result_metrics.attributed_revenue_bdt === "number"
                        ? `৳${cmp.result_metrics.attributed_revenue_bdt.toLocaleString()}`
                        : "not measured"}
                    </strong>
                  </span>
                  <span>ROAS: <strong>{typeof cmp.result_metrics.roas === "number" ? `${cmp.result_metrics.roas}x` : "—"}</strong></span>
                </div>
              )}

              {/* Action Buttons & Human Approval Gate */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "auto" }}>
                {cmp.status === "REVIEW" && (
                  <>
                    <button
                      className={styles.btnDanger}
                      onClick={() => handleRejectCampaign(cmp.id)}
                      disabled={actionLoading === `rej_${cmp.id}`}
                    >
                      <X size={14} /> Reject
                    </button>
                    <button
                      className={styles.btnPrimary}
                      onClick={() => handleApproveCampaign(cmp.id)}
                      disabled={actionLoading === `appr_${cmp.id}`}
                    >
                      <Check size={14} /> Approve Campaign
                    </button>
                  </>
                )}

                {cmp.status === "APPROVED" && (
                  <button
                    className={styles.btnPrimary}
                    onClick={() => handleDispatchCampaign(cmp.id)}
                    disabled={actionLoading === `disp_${cmp.id}`}
                  >
                    <Play size={14} /> Dispatch Broadcast (20/s)
                  </button>
                )}

                {cmp.status === "COMPLETED" && (
                  <span style={{ fontSize: "12px", color: "var(--color-text-secondary, #70736F)", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <CheckCircle2 size={14} color="#2E7D32" /> Completed & Attributed
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 5: REVENUE ATTRIBUTION */}
      {activeTab === "attribution" && (
        <div className={styles.bentoGrid}>
          {/* Top Attribution Overview */}
          <div className={`${styles.bentoCard} ${styles.col12}`}>
            <div className={styles.cardHeader}>
              <div>
                <h3 style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary, #202124)" }}>
                  Multi-Touch Marketing Attribution Model
                </h3>
                <p style={{ fontSize: "12px", color: "var(--color-text-secondary, #70736F)", marginTop: "2px" }}>
                  How revenue from recorded campaign touchpoints is credited under each model. Incremental lift needs a control group and isn't measured.
                </p>
              </div>

              {/* Model Selector */}
              <div style={{ display: "flex", gap: "6px", background: "#FAFBF8", padding: "4px", borderRadius: "10px", border: "1px solid var(--color-border-subtle, rgba(0,0,0,0.08))" }}>
                {(["LAST_TOUCH", "FIRST_TOUCH", "LINEAR", "TIME_DECAY"] as const).map((m) => (
                  <button
                    key={m}
                    className={`${styles.navTab} ${attributionModel === m ? styles.navTabActive : ""}`}
                    style={{ padding: "6px 12px", fontSize: "12px" }}
                    onClick={() => setAttributionModel(m)}
                  >
                    {m.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", margin: "16px 0" }}>
              <div style={{ padding: "16px", background: "#FAFBF8", borderRadius: "12px", border: "1px solid var(--color-border-subtle, rgba(0,0,0,0.06))" }}>
                <div style={{ fontSize: "12px", color: "var(--color-text-secondary, #70736F)", textTransform: "uppercase" }}>Total Attributed Revenue</div>
                <div style={{ fontSize: "28px", fontWeight: 700, color: "var(--color-text-primary, #202124)", marginTop: "4px" }}>
                  ৳{attribution?.total_attributed_revenue_bdt?.toLocaleString() || "0"}
                </div>
              </div>
              <div style={{ padding: "16px", background: "#FAFBF8", borderRadius: "12px", border: "1px solid var(--color-border-subtle, rgba(0,0,0,0.06))" }}>
                <div style={{ fontSize: "12px", color: "var(--color-text-secondary, #70736F)", textTransform: "uppercase" }}>Incremental Lift</div>
                <div style={{ fontSize: "28px", fontWeight: 700, color: "var(--color-text-muted)", marginTop: "4px" }}>
                  Not measured
                </div>
              </div>
              <div style={{ padding: "16px", background: "#FAFBF8", borderRadius: "12px", border: "1px solid var(--color-border-subtle, rgba(0,0,0,0.06))" }}>
                <div style={{ fontSize: "12px", color: "var(--color-text-secondary, #70736F)", textTransform: "uppercase" }}>Active Attribution Model</div>
                <div style={{ fontSize: "22px", fontWeight: 700, color: "var(--color-text-primary, #202124)", marginTop: "6px" }}>
                  {attributionModel.replace("_", " ")}
                </div>
              </div>
            </div>

            {/* Campaign Breakdown Table */}
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Campaign / Initiative</th>
                    <th>Channel</th>
                    <th>Attributed Orders</th>
                    <th>Attributed GMV</th>
                    <th>Incremental Lift</th>
                    <th>ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {attribution?.campaigns_breakdown?.map((item: any) => (
                    <tr key={item.id}>
                      <td style={{ fontWeight: 600 }}>{item.campaign_name}</td>
                      <td>
                        <span className={`${styles.statusPill} ${styles.statusApproved}`}>
                          {item.channel}
                        </span>
                      </td>
                      <td>{item.orders_attributed}</td>
                      <td style={{ fontWeight: 700 }}>৳{item.revenue_bdt?.toLocaleString()}</td>
                      <td style={{ color: "var(--color-text-muted)" }}>Not measured</td>
                      <td style={{ fontWeight: 600 }}>{typeof item.roas === "number" ? `${item.roas}x` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: INSPECT COHORT MEMBERS */}
      {isCohortModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>
                <Users size={20} /> {selectedCohort?.name} Members ({cohortMembers.length})
              </div>
              <button className={styles.closeButton} onClick={() => setIsCohortModalOpen(false)}>
                <X size={18} />
              </button>
            </div>

            {cohortMembers.length === 0 ? (
              <div style={{ padding: "30px", textAlign: "center", color: "var(--color-text-secondary, #70736F)" }}>
                No customers currently match this cohort criteria.
              </div>
            ) : (
              <div className={styles.tableWrapper} style={{ maxHeight: "350px", overflowY: "auto" }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Phone</th>
                      <th>Total Spent</th>
                      <th>Orders</th>
                      <th>Last Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cohortMembers.map((m) => (
                      <tr key={m.id}>
                        <td style={{ fontWeight: 600 }}>{m.name}</td>
                        <td style={{ fontSize: "12px" }}>{m.phone}</td>
                        <td style={{ fontWeight: 700 }}>৳{m.total_spend_bdt?.toLocaleString()}</td>
                        <td>{m.order_count}</td>
                        <td style={{ fontSize: "12px", color: "var(--color-text-secondary, #70736F)" }}>
                          {m.last_purchase_days_ago >= 999 ? "Never" : `${m.last_purchase_days_ago}d ago`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end" }}>
              <button className={styles.btnPrimary} onClick={() => setIsCohortModalOpen(false)}>
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CREATE BROADCAST CAMPAIGN */}
      {isNewCampaignModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>
                <Plus size={20} /> Create Governed Broadcast Campaign
              </div>
              <button className={styles.closeButton} onClick={() => setIsNewCampaignModalOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateCampaign}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Campaign Name</label>
                <input
                  type="text"
                  className={styles.formInput}
                  placeholder="e.g. Flash Friday Exclusive VIP Drop"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Target Audience Cohort</label>
                <select
                  className={styles.formSelect}
                  value={campaignAudienceId}
                  onChange={(e) => setCampaignAudienceId(e.target.value)}
                  required
                >
                  {audiences.map((aud) => (
                    <option key={aud.id} value={aud.id}>
                      {aud.name} ({aud.estimated_size} recipients)
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Channel</label>
                <select
                  className={styles.formSelect}
                  value={campaignChannel}
                  onChange={(e) => setCampaignChannel(e.target.value)}
                >
                  <option value="WHATSAPP">WhatsApp Business API (Capped 20/sec)</option>
                  <option value="FACEBOOK_MESSENGER">Facebook Messenger</option>
                  <option value="INSTAGRAM">Instagram Direct</option>
                </select>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Campaign Copy (Supports {`{customer_name}`})</label>
                <textarea
                  className={styles.formTextarea}
                  placeholder="Assalamu Alaikum {customer_name}! Apnar jonno exclusive offer..."
                  value={campaignContent}
                  onChange={(e) => setCampaignContent(e.target.value)}
                  required
                />
                <div style={{ fontSize: "11px", color: "var(--color-text-secondary, #70736F)", marginTop: "4px" }}>
                  ✦ Notice: Mandatorily includes opt-out `"Reply STOP to unsubscribe"`. Checked against live stock and prices.
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Budget (BDT ৳)</label>
                <input
                  type="number"
                  className={styles.formInput}
                  value={campaignBudget}
                  onChange={(e) => setCampaignBudget(e.target.value)}
                />
              </div>

              <div style={{ marginTop: "24px", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => setIsNewCampaignModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.btnPrimary}
                  disabled={actionLoading === "create_campaign"}
                >
                  Create & Run Safety Evaluation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
