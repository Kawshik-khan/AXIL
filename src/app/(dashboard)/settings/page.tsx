"use client";

import React, { useState, useEffect } from "react";
import { UserPlus, Save, ShieldAlert, CheckCircle2 } from "lucide-react";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { Input } from "@/components/ui/Input/Input";
import { Badge } from "@/components/ui/Badge/Badge";
import { Modal } from "@/components/ui/Modal/Modal";
import { LoadingSkeleton, PermissionDenied } from "@/components/ui/States/States";
import styles from "./settings.module.css";
import { ServiceTokensPanel } from "@/components/settings/ServiceTokensPanel";
import dashStyles from "../dashboard.module.css";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<"workspace" | "users" | "security" | "service-tokens">("workspace");
  const [session, setSession] = useState<any>(null);
  const [tenant, setTenant] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Workspace form state
  const [businessName, setBusinessName] = useState("");
  const [currency, setCurrency] = useState("BDT");
  const [timezone, setTimezone] = useState("Asia/Dhaka");
  const [insideDhakaFee, setInsideDhakaFee] = useState("60");
  const [outsideDhakaFee, setOutsideDhakaFee] = useState("120");
  const [contactPhone, setContactPhone] = useState("");
  const [telegramBot, setTelegramBot] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Invite modal state
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("SALES");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isInviting, setIsInviting] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash) {
      const hash = window.location.hash.replace("#", "");
      if (hash === "users" || hash === "security" || hash === "workspace") {
        setActiveTab(hash as any);
      }
    }
  }, []);

  const loadAllData = async () => {
    setIsLoading(true);
    try {
      const [sessRes, tenantRes, usersRes, auditRes] = await Promise.all([
        fetch("/api/v1/auth/session"),
        fetch("/api/v1/tenants/current"),
        fetch("/api/v1/users"),
        fetch("/api/v1/audit?limit=50"),
      ]);

      if (sessRes.ok) {
        const s = await sessRes.json();
        setSession(s.data);
      }
      if (tenantRes.ok) {
        const t = await tenantRes.json();
        const ten = t.data.tenant;
        setTenant(ten);
        setBusinessName(ten.name);
        setCurrency(ten.currency || "BDT");
        setTimezone(ten.timezone || "Asia/Dhaka");
        setContactPhone(String(ten.settings?.contact_phone ?? ""));
        setTelegramBot(String(ten.settings?.telegram_bot_username ?? ""));
        // The fees orders are charged (settings or the defaults in PricingService), not a second copy of the defaults
        setInsideDhakaFee(String(t.data.delivery_fees?.inside_dhaka_bdt ?? ten.settings?.delivery_charge_inside_dhaka ?? ""));
        setOutsideDhakaFee(String(t.data.delivery_fees?.outside_dhaka_bdt ?? ten.settings?.delivery_charge_outside_dhaka ?? ""));
      }
      if (usersRes.ok) {
        const u = await usersRes.json();
        setUsers(u.data.users || []);
        setInvitations(u.data.pending_invitations || []);
      }
      if (auditRes.ok) {
        const a = await auditRes.json();
        setAuditLogs(a.data.logs || []);
      }
    } catch {
      // Error handling
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  const handleSaveWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const res = await fetch("/api/v1/tenants/current/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: businessName,
          currency,
          timezone,
          settings: {
            delivery_charge_inside_dhaka: Number(insideDhakaFee),
            delivery_charge_outside_dhaka: Number(outsideDhakaFee),
            contact_phone: contactPhone,
            telegram_bot_username: telegramBot,
          },
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to update settings.");
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      loadAllData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);
    setIsInviting(true);

    try {
      const res = await fetch("/api/v1/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Failed to invite user.");
      }

      setIsInviteOpen(false);
      setInviteEmail("");
      // Shown once: the link is the invitation (no email delivery yet, FX-37)
      setLastInviteLink(data.data?.invite_path ? `${window.location.origin}${data.data.invite_path}` : null);
      loadAllData();
    } catch (err: any) {
      setInviteError(err.message);
    } finally {
      setIsInviting(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      const res = await fetch(`/api/v1/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error?.message || "Failed to change role.");
        return;
      }
      loadAllData();
    } catch {
      alert("Network error.");
    }
  };

  const handleStatusChange = async (userId: string, newStatus: string) => {
    if (!confirm(`Are you sure you want to mark this user as ${newStatus}?`)) return;
    try {
      const res = await fetch(`/api/v1/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error?.message || "Failed to update user status.");
        return;
      }
      loadAllData();
    } catch {
      alert("Network error.");
    }
  };

  if (isLoading) {
    return <LoadingSkeleton lines={6} height="300px" />;
  }

  const permissions = session?.permissions || [];
  const canManageSettings = permissions.includes("settings.update");
  const canReadUsers = permissions.includes("user.read");
  const canInviteUsers = permissions.includes("user.invite");
  const canReadAudit = permissions.includes("audit.read");
  const canManageServiceTokens = permissions.includes("service_tokens.manage");

  const handleSignOutEverywhere = async () => {
    if (!confirm("Sign out of every browser and device, including this one?")) return;
    await fetch("/api/v1/auth/sessions/revoke-all", { method: "POST", credentials: "include" });
    window.location.assign("/login");
  };

  return (
    <>
      <div className={dashStyles.pageHeader}>
        <div>
          <h1 className={dashStyles.pageTitle}>
            <span>Settings</span>
            <span style={{ fontSize: "14px", fontWeight: 400, color: "var(--color-text-muted)" }}>
              / {tenant?.name}
            </span>
          </h1>
          <p className={dashStyles.pageDescription}>
            Manage workspace identity, team permissions, delivery zones, and audit logs.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className={dashStyles.tabList}>
        <button
          className={`${dashStyles.tabButton} ${activeTab === "workspace" ? dashStyles.tabActive : ""}`}
          onClick={() => setActiveTab("workspace")}
        >
          Workspace Identity &amp; Logistics
        </button>
        <button
          className={`${dashStyles.tabButton} ${activeTab === "users" ? dashStyles.tabActive : ""}`}
          onClick={() => setActiveTab("users")}
        >
          Team Members &amp; Roles ({users.length})
        </button>
        <button
          className={`${dashStyles.tabButton} ${activeTab === "security" ? dashStyles.tabActive : ""}`}
          onClick={() => setActiveTab("security")}
        >
          Security &amp; Audit Logs ({auditLogs.length})
        </button>
        {canManageServiceTokens && (
          <button
            className={`${dashStyles.tabButton} ${activeTab === "service-tokens" ? dashStyles.tabActive : ""}`}
            onClick={() => setActiveTab("service-tokens")}
          >
            Service Tokens
          </button>
        )}
      </div>

      {/* Tab 1: Workspace Settings */}
      {activeTab === "workspace" && (
        <>
          {!canManageSettings ? (
            <PermissionDenied resource="workspace settings" requiredPermission="settings.update" />
          ) : (
            <form onSubmit={handleSaveWorkspace}>
              <BentoGrid>
                <BentoCard span={6} title="Store Identity" subtitle="Core branding and regional currency">
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <Input
                      label="Store / Business Name"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      required
                    />

                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <label style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)" }}>
                        Default Currency
                      </label>
                      <select
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        style={{
                          padding: "10px 14px",
                          borderRadius: "var(--radius-control)",
                          border: "1px solid var(--color-border-subtle)",
                          backgroundColor: "var(--color-surface-pure)",
                          fontSize: "13px",
                          color: "var(--color-text-primary)",
                        }}
                      >
                        <option value="BDT">BDT (৳) — Bangladeshi Taka</option>
                        <option value="USD">USD ($) — US Dollar</option>
                        <option value="EUR">EUR (€) — Euro</option>
                      </select>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <label style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)" }}>
                        Operating Timezone
                      </label>
                      <select
                        value={timezone}
                        onChange={(e) => setTimezone(e.target.value)}
                        style={{
                          padding: "10px 14px",
                          borderRadius: "var(--radius-control)",
                          border: "1px solid var(--color-border-subtle)",
                          backgroundColor: "var(--color-surface-pure)",
                          fontSize: "13px",
                          color: "var(--color-text-primary)",
                        }}
                      >
                        <option value="Asia/Dhaka">Asia/Dhaka (GMT+6)</option>
                        <option value="UTC">UTC</option>
                        <option value="America/New_York">America/New_York (EST)</option>
                      </select>
                    </div>
                  </div>
                </BentoCard>

                <BentoCard span={6} title="Customer Contact" subtitle="Where customers can message your store">
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <Input
                      label="Phone / WhatsApp Number"
                      type="tel"
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      placeholder="+8801712345678"
                      hint="Include the country code. Leave empty to hide."
                    />

                    <Input
                      label="Telegram Bot Username"
                      value={telegramBot}
                      onChange={(e) => setTelegramBot(e.target.value)}
                      placeholder="@mystore_bot"
                      hint="The bot customers open in Telegram; the username ends in 'bot'. Leave empty to hide."
                    />
                  </div>
                </BentoCard>

                <BentoCard span={6} title="Bangladesh Delivery Logistics" subtitle="Standard delivery fee defaults">
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <Input
                      label="Inside Dhaka Delivery Charge (BDT)"
                      type="number"
                      value={insideDhakaFee}
                      onChange={(e) => setInsideDhakaFee(e.target.value)}
                      hint="Applied automatically to Dhaka Metro addresses (Default: 60 BDT)"
                      required
                    />

                    <Input
                      label="Outside Dhaka Delivery Charge (BDT)"
                      type="number"
                      value={outsideDhakaFee}
                      onChange={(e) => setOutsideDhakaFee(e.target.value)}
                      hint="Applied to sub-urban and nationwide 64 districts (Default: 120 BDT)"
                      required
                    />

                    <div style={{ marginTop: "8px", display: "flex", alignItems: "center", gap: "12px" }}>
                      <Button type="submit" variant="primary" isLoading={isSaving} icon={<Save size={16} />}>
                        Save Settings
                      </Button>
                      {saveSuccess && (
                        <span style={{ color: "var(--color-success)", fontSize: "13px", display: "flex", alignItems: "center", gap: "4px" }}>
                          <CheckCircle2 size={16} /> Saved successfully
                        </span>
                      )}
                    </div>
                  </div>
                </BentoCard>
              </BentoGrid>
            </form>
          )}
        </>
      )}

      {/* Tab 2: Team Members & RBAC */}
      {activeTab === "users" && (
        <>
          {!canReadUsers ? (
            <PermissionDenied resource="team management" requiredPermission="user.read" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ fontSize: "16px", fontWeight: 600 }}>Active Team Members</h3>
                  <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                    Team members operate within strictly scoped role permissions.
                  </p>
                </div>
                {canInviteUsers && (
                  <Button variant="primary" size="sm" onClick={() => setIsInviteOpen(true)} icon={<UserPlus size={16} />}>
                    + Invite Member
                  </Button>
                )}
              </div>

              <div className={dashStyles.tableContainer}>
                <table className={dashStyles.table}>
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Last Active</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <div>
                            <strong>{u.name}</strong>
                            <p style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>{u.email}</p>
                          </div>
                        </td>
                        <td>
                          <Badge variant={u.role.toLowerCase() as any}>{u.role}</Badge>
                        </td>
                        <td>
                          <Badge variant={u.status.toLowerCase() as any}>{u.status}</Badge>
                        </td>
                        <td style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                          {u.last_login_at
                            ? new Date(u.last_login_at).toLocaleDateString()
                            : "Never"}
                        </td>
                        <td>
                          {u.id !== session?.user?.id && (
                            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                              <select
                                value={u.role}
                                onChange={(e) => handleRoleChange(u.id, e.target.value)}
                                style={{
                                  padding: "4px 8px",
                                  fontSize: "11px",
                                  borderRadius: "var(--radius-sm)",
                                  border: "1px solid var(--color-border-subtle)",
                                }}
                              >
                                <option value="ADMIN">ADMIN</option>
                                <option value="DEV">DEV</option>
                                <option value="MANAGER">MANAGER</option>
                                <option value="SALES">SALES</option>
                                <option value="SUPPORT">SUPPORT</option>
                                <option value="MARKETING">MARKETING</option>
                                <option value="INVENTORY">INVENTORY</option>
                                <option value="FINANCE">FINANCE</option>
                                <option value="ANALYST">ANALYST</option>
                              </select>

                              {u.account_status && u.account_status !== "ACTIVE" ? (
                                // Account-level states (invited, deactivated) aren't changed from a workspace.
                                <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                                  Account {String(u.account_status).toLowerCase()}
                                </span>
                              ) : u.membership_status === "SUSPENDED" ? (
                                <button
                                  onClick={() => handleStatusChange(u.id, "ACTIVE")}
                                  style={{ color: "var(--color-success)", fontSize: "11px", fontWeight: 500 }}
                                >
                                  Restore access
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleStatusChange(u.id, "SUSPENDED")}
                                  style={{ color: "var(--color-danger)", fontSize: "11px", fontWeight: 500 }}
                                >
                                  Suspend
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {lastInviteLink && (
                <div
                  style={{
                    marginTop: "16px",
                    padding: "12px",
                    border: "1px solid var(--color-border-subtle)",
                    borderRadius: "var(--radius-control)",
                    fontSize: "13px",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: "6px" }}>Invite link (shown once)</div>
                  <div style={{ color: "var(--color-text-secondary)", marginBottom: "8px" }}>
                    Send this link to the person you invited. It works once and expires in 7 days.
                  </div>
                  <code style={{ fontSize: "12px", wordBreak: "break-all" }}>{lastInviteLink}</code>
                  <div style={{ marginTop: "8px", display: "flex", gap: "8px" }}>
                    <Button type="button" variant="secondary" onClick={() => void navigator.clipboard?.writeText(lastInviteLink)}>
                      Copy invite link
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setLastInviteLink(null)}>
                      Done
                    </Button>
                  </div>
                </div>
              )}

              {invitations.length > 0 && (
                <div style={{ marginTop: "16px" }}>
                  <h4 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>
                    Pending Invitations
                  </h4>
                  <div className={dashStyles.tableContainer}>
                    <table className={dashStyles.table}>
                      <thead>
                        <tr>
                          <th>Invited Email</th>
                          <th>Role</th>
                          <th>Expires</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invitations.map((inv) => (
                          <tr key={inv.id}>
                            <td>{inv.email}</td>
                            <td>
                              <Badge variant={inv.role.toLowerCase() as any}>{inv.role}</Badge>
                            </td>
                            <td style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                              {new Date(inv.expires_at).toLocaleDateString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Tab 4: Service tokens for automations (FX-18) */}
      {activeTab === "service-tokens" && canManageServiceTokens && <ServiceTokensPanel />}

      {/* Tab 3: Security & Audit Logs */}
      {activeTab === "security" && (
        <>
          {!canReadAudit ? (
            <PermissionDenied resource="audit logs" requiredPermission="audit.read" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
                <div>
                  <h3 style={{ fontSize: "16px", fontWeight: 600 }}>Immutable Workspace Audit Trail</h3>
                <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  All authentication, role updates, and settings changes are recorded permanently.
                </p>
                </div>
                <Button type="button" variant="secondary" onClick={handleSignOutEverywhere}>
                  Sign out everywhere
                </Button>
              </div>

              <div className={dashStyles.tableContainer}>
                <table className={dashStyles.table}>
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Action</th>
                      <th>Resource</th>
                      <th>Actor ID</th>
                      <th>Metadata</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td style={{ fontSize: "12px", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td>
                          <strong>{log.action}</strong>
                        </td>
                        <td>
                          <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                            {log.resource_type}: {log.resource_id}
                          </span>
                        </td>
                        <td>
                          <code style={{ fontSize: "11px" }}>{log.actor_user_id}</code>
                        </td>
                        <td style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                          {JSON.stringify(log.metadata)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Invite Member Modal */}
      <Modal isOpen={isInviteOpen} onClose={() => setIsInviteOpen(false)} title="Invite Team Member">
        <form onSubmit={handleSendInvite} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {inviteError && (
            <div style={{ padding: "8px 12px", backgroundColor: "var(--color-danger-bg)", color: "var(--color-danger)", borderRadius: "var(--radius-control)", fontSize: "12px" }}>
              {inviteError}
            </div>
          )}

          <Input
            label="Colleague Email Address"
            type="email"
            placeholder="member@store.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
          />

          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)" }}>
              Assigned Role
            </label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              style={{
                padding: "10px 14px",
                borderRadius: "var(--radius-control)",
                border: "1px solid var(--color-border-subtle)",
                backgroundColor: "var(--color-surface-pure)",
                fontSize: "13px",
                color: "var(--color-text-primary)",
              }}
            >
              <option value="ADMIN">ADMIN — Full management &amp; settings</option>
              <option value="DEV">DEV — AI agents, developer tools &amp; telemetry</option>
              <option value="MANAGER">MANAGER — Operations, catalog &amp; orders</option>
              <option value="SALES">SALES — Order creation &amp; customer chat</option>
              <option value="SUPPORT">SUPPORT — Customer inquiries &amp; order tracking</option>
              <option value="MARKETING">MARKETING — Campaigns &amp; promotional coupons</option>
              <option value="INVENTORY">INVENTORY — Stock adjustments &amp; alerts</option>
              <option value="FINANCE">FINANCE — Reconciliation &amp; refunds</option>
              <option value="ANALYST">ANALYST — Read-only BI reports</option>
            </select>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
            <Button type="button" variant="ghost" onClick={() => setIsInviteOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isInviting}>
              Send Invitation
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
