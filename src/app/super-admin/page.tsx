"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  LayoutGrid,
  Building2,
  CreditCard,
  Sliders,
  Workflow,
  Activity,
  ShieldAlert,
  UserCheck,
  ScrollText,
  Settings,
  Search,
  KeyRound,
  Store,
  Plus,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Shield,
  X,
  Filter,
  Download,
  Play,
  RotateCcw,
  Eye,
  Lock,
  ShoppingBag,
  Bot,
  Zap,
  Radio,
  LogOut,
} from "lucide-react";
import { platformFetch, readPlatformError, PLATFORM_LOGIN_PATH } from "./platform-client";
import styles from "./super-admin.module.css";
import { AgentHealthPanel } from "./agent-health-panel";

type OperationalTab =
  | "OVERVIEW"
  | "TENANTS"
  | "PLANS"
  | "ENTITLEMENTS"
  | "AUTOMATIONS"
  | "HEALTH"
  | "AGENTS"
  | "SAFETY"
  | "SECURITY"
  | "AUDIT"
  | "SETTINGS";

// Platform numbers or a dash: never a made-up fallback (FX-30).
const numOrDash = (v: unknown) => (typeof v === "number" ? v.toLocaleString() : "—");
const bdtOrDash = (v: unknown) => (typeof v === "number" ? `৳${v.toLocaleString("en-BD")}` : "—");
const pctOrDash = (v: unknown) => (typeof v === "number" ? `${v}%` : "—");

export default function SuperAdminPage() {
  const [activeTab, setActiveTab] = useState<OperationalTab>("OVERVIEW");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Platform Telemetry State
  const [overview, setOverview] = useState<any>(null);
  const [tenants, setTenants] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [entitlements, setEntitlements] = useState<any[]>([]);
  const [automations, setAutomations] = useState<any>(null);
  const [n8nCluster, setN8nCluster] = useState<any>(null);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [killSwitches, setKillSwitches] = useState<any[]>([]);
  const [operators, setOperators] = useState<any[]>([]);
  const [impersonations, setImpersonations] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [settings, setSettings] = useState<any[]>([]);
  const [featureFlags, setFeatureFlags] = useState<any[]>([]);

  // Search & Filter State
  const [tenantSearch, setTenantSearch] = useState("");
  const [tenantStatusFilter, setTenantStatusFilter] = useState("ALL");
  const [auditSearch, setAuditSearch] = useState("");

  // Modals & Drawers
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [tenantDetail, setTenantDetail] = useState<any>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [showProvisionModal, setShowProvisionModal] = useState(false);
  const [showSuspendModal, setShowSuspendModal] = useState<string | null>(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [showImpersonateModal, setShowImpersonateModal] = useState<string | null>(null);
  const [impersonateReason, setImpersonateReason] = useState("");
  const [impersonateTicket, setImpersonateTicket] = useState("");
  const [impersonateMode, setImpersonateMode] = useState<"READ_ONLY" | "MUTATION_APPROVED">("READ_ONLY");
  const [showKillSwitchModal, setShowKillSwitchModal] = useState(false);
  const [killSwitchScope, setKillSwitchScope] = useState<"GLOBAL" | "TENANT" | "WORKFLOW">("GLOBAL");
  const [killSwitchTargetId, setKillSwitchTargetId] = useState("");
  const [killSwitchReason, setKillSwitchReason] = useState("");
  const [killSwitchConfirmation, setKillSwitchConfirmation] = useState("");
  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [incidentTitle, setIncidentTitle] = useState("");
  const [incidentSeverity, setIncidentSeverity] = useState<"SEV1" | "SEV2" | "SEV3" | "SEV4">("SEV2");
  const [incidentComponent, setIncidentComponent] = useState("n8n_cluster");
  const [incidentDescription, setIncidentDescription] = useState("");
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [showStepUpModal, setShowStepUpModal] = useState(false);
  const [stepUpCode, setStepUpCode] = useState("");
  const [stepUpToken, setStepUpToken] = useState<string | null>(null);
  const [stepUpVerified, setStepUpVerified] = useState(false);
  const [stepUpError, setStepUpError] = useState<string | null>(null);
  const [mfaSetupNeeded, setMfaSetupNeeded] = useState(false);
  const [mfaEnrollment, setMfaEnrollment] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [mfaEnrollCode, setMfaEnrollCode] = useState("");
  const [mfaSetupPassword, setMfaSetupPassword] = useState("");
  const [operator, setOperator] = useState<{ name: string; role: string } | null>(null);

  // Tenant Provisioning Form State
  const [provisionForm, setProvisionForm] = useState({
    name: "",
    slug: "",
    legal_name: "",
    plan_id: "GROWTH",
    owner_email: "",
    owner_name: "",
  });

  // Time & Latency
  const [currentTime, setCurrentTime] = useState("");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
          " BST (Dhaka UTC+6)"
      );
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  // Keyboard shortcut for Command Palette (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
      }
      if (e.key === "Escape") {
        setShowCommandPalette(false);
        setIsDetailOpen(false);
        setShowProvisionModal(false);
        setShowSuspendModal(null);
        setShowImpersonateModal(null);
        setShowKillSwitchModal(false);
        setShowIncidentModal(false);
        setShowStepUpModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Fetch all initial platform data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Identity comes from the platform session cookie; platformFetch redirects to sign-in on 401.
      const load = (url: string) => platformFetch(url, {}, stepUpToken).then((r) => r.json());

      const sessionRes = await load("/api/v1/platform/auth/session");
      if (sessionRes.data?.user) {
        setOperator({ name: sessionRes.data.user.name, role: sessionRes.data.role });
      }

      const [
        overviewRes,
        tenantsRes,
        plansRes,
        subsRes,
        entitlementsRes,
        automationsRes,
        n8nRes,
        incidentsRes,
        killSwitchesRes,
        usersRes,
        impersonateRes,
        auditRes,
        settingsRes,
        flagsRes,
      ] = await Promise.all([
        load("/api/v1/platform/overview"),
        load("/api/v1/platform/tenants"),
        load("/api/v1/platform/plans"),
        load("/api/v1/platform/subscriptions"),
        load("/api/v1/platform/entitlements"),
        load("/api/v1/platform/automations"),
        load("/api/v1/platform/n8n"),
        load("/api/v1/platform/incidents"),
        load("/api/v1/platform/safety/kill-switch"),
        load("/api/v1/platform/users"),
        load("/api/v1/platform/support/impersonate"),
        load("/api/v1/platform/audit"),
        load("/api/v1/platform/settings"),
        load("/api/v1/platform/feature-flags"),
      ]);

      if (overviewRes.data) setOverview(overviewRes.data);
      if (tenantsRes.data) setTenants(tenantsRes.data);
      if (plansRes.data) setPlans(plansRes.data);
      if (subsRes.data) setSubscriptions(subsRes.data);
      if (entitlementsRes.data) setEntitlements(entitlementsRes.data);
      if (automationsRes.data) setAutomations(automationsRes.data);
      if (n8nRes.data) setN8nCluster(n8nRes.data);
      if (incidentsRes.data) setIncidents(incidentsRes.data);
      if (killSwitchesRes.data) setKillSwitches(killSwitchesRes.data);
      if (usersRes.data) setOperators(usersRes.data);
      if (impersonateRes.data) setImpersonations(impersonateRes.data);
      if (auditRes.data) setAuditLogs(auditRes.data);
      if (settingsRes.data) setSettings(settingsRes.data);
      if (flagsRes.data) setFeatureFlags(flagsRes.data);
    } catch (err: any) {
      setError(err.message || "Failed to load platform data");
    } finally {
      setLoading(false);
    }
  }, [stepUpToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Provision Tenant Handler
  const handleProvisionTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await platformFetch(
        "/api/v1/platform/tenants",
        { method: "POST", body: JSON.stringify(provisionForm) },
        stepUpToken
      );
      if (!res.ok) throw new Error(await readPlatformError(res, "Provisioning failed"));
      const created = await res.json().catch(() => null);
      const setupPath: string | null = created?.data?.owner_setup_path ?? null;
      if (setupPath) {
        // Shown once: the owner sets their password with it (no email delivery yet; audit N8)
        window.prompt("Send this one-time setup link to the workspace owner (valid 7 days):", `${window.location.origin}${setupPath}`);
      }
      setShowProvisionModal(false);
      setProvisionForm({
        name: "",
        slug: "",
        legal_name: "",
        plan_id: "GROWTH",
        owner_email: "",
        owner_name: "",
      });
      await fetchData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Suspend Tenant Handler
  const handleSuspendTenant = async () => {
    if (!showSuspendModal) return;
    try {
      const res = await platformFetch(
        `/api/v1/platform/tenants/${encodeURIComponent(showSuspendModal)}/suspend`,
        { method: "POST", body: JSON.stringify({ reason: suspendReason || "Administrative governance suspension" }) },
        stepUpToken
      );
      if (!res.ok) throw new Error(await readPlatformError(res, "Suspension failed"));
      setShowSuspendModal(null);
      setSuspendReason("");
      await fetchData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Activate Tenant Handler
  const handleActivateTenant = async (tenantId: string) => {
    try {
      const res = await platformFetch(
        `/api/v1/platform/tenants/${encodeURIComponent(tenantId)}/activate`,
        { method: "POST", body: JSON.stringify({ reason: "Administrative reinstatement" }) },
        stepUpToken
      );
      if (!res.ok) throw new Error(await readPlatformError(res, "Activation failed"));
      await fetchData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Inspect Tenant in Drawer
  const handleInspectTenant = async (tenantId: string) => {
    setSelectedTenantId(tenantId);
    setIsDetailOpen(true);
    try {
      const res = await platformFetch(`/api/v1/platform/tenants/${encodeURIComponent(tenantId)}`, {}, stepUpToken);
      const data = await res.json();
      if (data.data) setTenantDetail(data.data);
    } catch {
      // Ignore
    }
  };

  // Create Impersonation Session Handler
  const handleCreateImpersonation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showImpersonateModal) return;
    try {
      const res = await platformFetch(
        "/api/v1/platform/support/impersonate",
        {
          method: "POST",
          body: JSON.stringify({
            tenant_id: showImpersonateModal,
            ...(impersonateTicket ? { ticket_id: impersonateTicket } : {}),
            reason: impersonateReason,
            mode: impersonateMode,
            duration_minutes: 60,
          }),
        },
        stepUpToken
      );
      if (!res.ok) throw new Error(await readPlatformError(res, "Impersonation session failed"));
      setShowImpersonateModal(null);
      setImpersonateReason("");
      setImpersonateTicket("");
      // The session is a cookie now (FX-34); open the workspace. A banner there ends it.
      window.location.href = "/";
      await fetchData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Revoke Impersonation Session
  const handleRevokeImpersonation = async (sessionId: string) => {
    try {
      // The route is DELETE /api/v1/platform/support/impersonate?sessionId=… (audit M1: the old POST …/revoke URL did not exist).
      const query = new URLSearchParams({ sessionId, reason: "Revoked by operator from control plane" });
      const res = await platformFetch(`/api/v1/platform/support/impersonate?${query.toString()}`, { method: "DELETE" }, stepUpToken);
      if (!res.ok) throw new Error(await readPlatformError(res, "Revocation failed"));
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Revocation failed");
    }
  };

  // Engage Kill Switch Handler
  const handleEngageKillSwitch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (killSwitchConfirmation !== "CONFIRM KILL SWITCH") {
      alert('Please type "CONFIRM KILL SWITCH" to verify emergency stop authorization.');
      return;
    }
    try {
      const res = await platformFetch(
        "/api/v1/platform/safety/kill-switch",
        {
          method: "POST",
          body: JSON.stringify({
            scope: killSwitchScope,
            targetId: killSwitchTargetId || "GLOBAL_ALL", // the route reads `targetId`
            reason: killSwitchReason || "Emergency platform safety intervention",
          }),
        },
        stepUpToken
      );
      if (!res.ok) throw new Error(await readPlatformError(res, "Kill switch engagement failed"));
      setShowKillSwitchModal(false);
      setKillSwitchReason("");
      setKillSwitchConfirmation("");
      await fetchData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Disengage Kill Switch
  const handleDisengageKillSwitch = async (id: string) => {
    try {
      // Deactivation is POST /api/v1/platform/safety/kill-switch with action DEACTIVATE (audit M1: …/{id}/deactivate did not exist).
      const res = await platformFetch(
        "/api/v1/platform/safety/kill-switch",
        { method: "POST", body: JSON.stringify({ action: "DEACTIVATE", id, reason: "Deactivated by operator from control plane" }) },
        stepUpToken
      );
      if (!res.ok) throw new Error(await readPlatformError(res, "Kill switch deactivation failed"));
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Kill switch deactivation failed");
    }
  };

  // Declare Incident Handler
  const handleDeclareIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await platformFetch(
        "/api/v1/platform/incidents",
        {
          method: "POST",
          body: JSON.stringify({
            title: incidentTitle,
            severity: incidentSeverity,
            affected_component: incidentComponent,
            initial_message: incidentDescription || "Engineering team is currently investigating the incident.",
          }),
        },
        stepUpToken
      );
      if (!res.ok) throw new Error(await readPlatformError(res, "Incident declaration failed"));
      setShowIncidentModal(false);
      setIncidentTitle("");
      setIncidentDescription("");
      await fetchData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Step-Up Elevation Handler
  const readError = async (res: Response, fallback: string): Promise<{ code?: string; message: string }> => {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    return { code: body?.error?.code, message: body?.error?.message || fallback };
  };

  // Step-up with a fresh TOTP code (FX-15). Elevation is granted only when the server returns a signed step-up token.
  const handleStepUpElevation = async (e: React.FormEvent) => {
    e.preventDefault();
    setStepUpError(null);
    try {
      const res = await platformFetch(
        "/api/v1/platform/auth/step-up",
        { method: "POST", body: JSON.stringify({ code: stepUpCode.trim(), action: "CRITICAL_PLATFORM_OPERATION" }) },
        null
      );
      if (!res.ok) {
        const err = await readError(res, "Step-up elevation failed.");
        if (err.code === "MFA_NOT_ENROLLED") setMfaSetupNeeded(true);
        setStepUpError(err.message);
        return;
      }
      const data = await res.json();
      if (!data.data?.stepUpToken) throw new Error("Step-up elevation was not granted.");
      setStepUpToken(data.data.stepUpToken);
      setStepUpVerified(true);
      setShowStepUpModal(false);
      setStepUpCode("");
    } catch (err) {
      setStepUpError(err instanceof Error ? err.message : "Step-up elevation failed.");
    }
  };

  const handleStartMfaSetup = async () => {
    setStepUpError(null);
    const res = await platformFetch(
      "/api/v1/platform/auth/mfa/enroll",
      { method: "POST", body: JSON.stringify({ password: mfaSetupPassword }) },
      null
    );
    setMfaSetupPassword("");
    if (!res.ok) {
      setStepUpError((await readError(res, "Authenticator setup could not start.")).message);
      return;
    }
    const data = await res.json();
    setMfaEnrollment(data.data);
  };

  const handleConfirmMfaSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setStepUpError(null);
    const res = await platformFetch(
      "/api/v1/platform/auth/mfa/confirm",
      { method: "POST", body: JSON.stringify({ code: mfaEnrollCode.trim() }) },
      null
    );
    if (!res.ok) {
      setStepUpError((await readError(res, "The code could not be verified.")).message);
      return;
    }
    setMfaEnrollment(null);
    setMfaEnrollCode("");
    setMfaSetupNeeded(false);
    setStepUpError("Authenticator set up. Wait for the next code, then enter it to elevate.");
  };

  // Sign out of the platform control plane (clears the httpOnly platform session cookie server-side).
  const handleSignOut = async () => {
    try {
      await fetch("/api/v1/platform/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      window.location.assign(PLATFORM_LOGIN_PATH);
    }
  };

  // Filtered Tenants
  const filteredTenants = tenants.filter((t) => {
    const matchesSearch =
      t.name.toLowerCase().includes(tenantSearch.toLowerCase()) ||
      t.slug.toLowerCase().includes(tenantSearch.toLowerCase());
    const matchesStatus = tenantStatusFilter === "ALL" || t.status === tenantStatusFilter;
    return matchesSearch && matchesStatus;
  });

  // Filtered Audit Logs
  const filteredAudit = auditLogs.filter((a) => {
    if (!auditSearch) return true;
    const q = auditSearch.toLowerCase();
    return (
      a.action.toLowerCase().includes(q) ||
      a.actor_id.toLowerCase().includes(q) ||
      (a.target_resource_id && a.target_resource_id.toLowerCase().includes(q))
    );
  });

  // Dock items definition
  const DOCK_ITEMS: { id: OperationalTab; label: string; icon: React.ReactNode }[] = [
    { id: "OVERVIEW", label: "Command Center", icon: <LayoutGrid size={20} strokeWidth={2} /> },
    { id: "TENANTS", label: "Tenants Fleet", icon: <Building2 size={20} strokeWidth={2} /> },
    { id: "PLANS", label: "Plans & Billing", icon: <CreditCard size={20} strokeWidth={2} /> },
    { id: "ENTITLEMENTS", label: "Feature Quotas", icon: <Sliders size={20} strokeWidth={2} /> },
    { id: "AUTOMATIONS", label: "n8n & Automations", icon: <Workflow size={20} strokeWidth={2} /> },
    { id: "HEALTH", label: "Incidents & Health", icon: <Activity size={20} strokeWidth={2} /> },
    { id: "AGENTS", label: "Agent Health", icon: <Bot size={20} strokeWidth={2} /> },
    { id: "SAFETY", label: "Kill Switch", icon: <ShieldAlert size={20} strokeWidth={2} /> },
    { id: "SECURITY", label: "Impersonation & Security", icon: <UserCheck size={20} strokeWidth={2} /> },
    { id: "AUDIT", label: "Forensic Ledger", icon: <ScrollText size={20} strokeWidth={2} /> },
    { id: "SETTINGS", label: "Platform Settings", icon: <Settings size={20} strokeWidth={2} /> },
  ];

  return (
    <div className={styles.container}>
      {/* ============================================================
          TOP STATUS BAR (Sticky Glass with Progressive Blur)
          ============================================================ */}
      <header className={styles.statusBar} role="banner">
        <div className={styles.statusLeft}>
          <div className={styles.brandBadge}>
            <div className={styles.brandDot} />
            <span>CommerceOS</span>
          </div>

          <div className={styles.scopeBadge}>
            <Shield size={12} strokeWidth={2.5} />
            <span>PLATFORM SCOPE</span>
          </div>

          <div className={styles.timeBadge}>
            <Clock size={12} />
            <span>{currentTime || "Loading BST..."}</span>
          </div>
        </div>

        <div className={styles.statusRight}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
            onClick={() => setShowCommandPalette(true)}
            title="Search Platform (⌘K / Ctrl+K)"
          >
            <Search size={13} />
            <span>⌘K Command Palette</span>
          </button>

          {stepUpVerified ? (
            <span className={styles.stepUpTag} title="Elevated privileged operations allowed">
              🛡️ Step-Up Active
            </span>
          ) : (
            <button
              type="button"
              className={styles.stepUpPendingTag}
              onClick={() => setShowStepUpModal(true)}
              title="Click to elevate permissions via Step-Up MFA"
            >
              🔒 Verify Step-Up
            </button>
          )}

          <div className={styles.userBadge}>
            <span className={styles.roleTag}>{operator?.role ?? "—"}</span>
            <span>{operator?.name ?? "Platform operator"}</span>
          </div>

          <button
            type="button"
            className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
            onClick={handleSignOut}
            title="Sign out of the platform control plane"
          >
            <LogOut size={13} />
            <span>Sign out</span>
          </button>

          <Link
            href="/"
            className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
            title="Switch to Tenant Merchant Store Workspace (Store Operations)"
          >
            <Store size={13} />
            <span>Merchant Store Ops</span>
          </Link>
        </div>
      </header>

      {/* ============================================================
          DETACHED VERTICAL FLOATING COMMAND DOCK (Left Margin)
          Per .agent/DESIGN_SYSTEM.md: ~68px wide, detached, rounded
          ============================================================ */}
      <nav className={styles.dockWrapper} aria-label="Platform Operational Command Dock">
        <div className={styles.dockPill}>
          {DOCK_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`${styles.dockCircle} ${isActive ? styles.activeCircle : styles.inactiveCircle}`}
                onClick={() => setActiveTab(item.id)}
                aria-label={item.label}
              >
                {item.icon}
                <span className={styles.dockTooltip}>{item.label}</span>
              </button>
            );
          })}

          <div className={styles.dockDivider} />

          <button
            type="button"
            className={`${styles.dockCircle} ${styles.inactiveCircle}`}
            onClick={() => setShowCommandPalette(true)}
            aria-label="Search (⌘K)"
          >
            <Search size={18} strokeWidth={2} />
            <span className={styles.dockTooltip}>Quick Search (⌘K)</span>
          </button>

          <button
            type="button"
            className={`${styles.dockCircle} ${stepUpVerified ? styles.activeCircle : styles.inactiveCircle}`}
            onClick={() => setShowStepUpModal(true)}
            aria-label="Step-Up MFA"
          >
            <KeyRound size={18} strokeWidth={2} />
            <span className={styles.dockTooltip}>Step-Up MFA Elevation</span>
          </button>
        </div>
      </nav>

      {/* ============================================================
          MAIN OPERATIONAL VIEW CONTAINER (12-Column Bento Grid)
          ============================================================ */}
      <main className={styles.mainWrapper}>
        {/* Dynamic Page Header */}
        <div className={styles.pageHeader}>
          <div className={styles.headerTitleArea}>
            <h1 className={styles.headerTitle}>
              {activeTab === "OVERVIEW" && "Platform Command Center"}
              {activeTab === "TENANTS" && "Tenants Fleet Management"}
              {activeTab === "PLANS" && "SaaS Plans & Billing Architecture"}
              {activeTab === "ENTITLEMENTS" && "Centralized Entitlements & Quotas"}
              {activeTab === "AUTOMATIONS" && "Automations & n8n Worker Fleet"}
              {activeTab === "HEALTH" && "System Health & Incident Command"}
              {activeTab === "AGENTS" && "Customer Agent Health"}
              {activeTab === "SAFETY" && "Platform Safety & Emergency Kill Switch"}
              {activeTab === "SECURITY" && "Security Posture & Support Impersonation"}
              {activeTab === "AUDIT" && "Immutable Forensic Audit Ledger"}
              {activeTab === "SETTINGS" && "Platform Configuration & Feature Flags"}
            </h1>
            <p className={styles.headerSubtitle}>
              {activeTab === "OVERVIEW" && "Authoritative SaaS control plane operating across multi-tenant boundaries without compromising tenant data isolation."}
              {activeTab === "TENANTS" && "Lifecycle management, workspace provisioning, state transitions, and per-tenant governance."}
              {activeTab === "PLANS" && "Versioned subscription plans, BDT billing terms, and active subscriber distribution."}
              {activeTab === "ENTITLEMENTS" && "Platform feature gates, usage enforcement, and authorized tenant overrides."}
              {activeTab === "AUTOMATIONS" && "n8n worker cluster telemetry, execution queues, and Dead-Letter Queue (DLQ) operations."}
              {activeTab === "HEALTH" && "Infrastructure node health, live outage reporting, and SEV1-SEV4 incident response."}
              {activeTab === "AGENTS" && "Turns, latency, cost, guard triggers and handoffs of the customer agent across every workspace, from recorded runs."}
              {activeTab === "SAFETY" && "Emergency operational stops with typed confirmation and scoped kill switches."}
              {activeTab === "SECURITY" && "Zero-trust operator RBAC, dual-actor support impersonation, and MFA enforcement."}
              {activeTab === "AUDIT" && "Tamper-evident forensic audit ledger with before/after state diffs and SHA-256 exports."}
              {activeTab === "SETTINGS" && "Maintenance switches, global parameters, and percentage-based canary feature flags."}
            </p>
          </div>

          <div className={styles.headerActions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={fetchData}
              disabled={loading}
              title="Refresh Platform Telemetry"
            >
              <RefreshCw size={14} className={loading ? styles.skeletonPulse : ""} />
              <span>Refresh</span>
            </button>

            {activeTab === "TENANTS" && (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => setShowProvisionModal(true)}
              >
                <Plus size={14} />
                <span>Provision Tenant</span>
              </button>
            )}

            {activeTab === "HEALTH" && (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={() => setShowIncidentModal(true)}
              >
                <AlertTriangle size={14} />
                <span>Declare Incident</span>
              </button>
            )}

            {activeTab === "SAFETY" && (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={() => setShowKillSwitchModal(true)}
              >
                <ShieldAlert size={14} />
                <span>Engage Kill Switch</span>
              </button>
            )}
          </div>
        </div>

        {/* Loading Pulse State */}
        {loading && !overview && (
          <div className={styles.bentoGrid}>
            <div className={`${styles.bentoCard} ${styles.col4} ${styles.skeletonPulse}`} style={{ height: 160 }} />
            <div className={`${styles.bentoCard} ${styles.col4} ${styles.skeletonPulse}`} style={{ height: 160 }} />
            <div className={`${styles.bentoCard} ${styles.col4} ${styles.skeletonPulse}`} style={{ height: 160 }} />
            <div className={`${styles.bentoCard} ${styles.col8} ${styles.skeletonPulse}`} style={{ height: 260 }} />
            <div className={`${styles.bentoCard} ${styles.col4} ${styles.skeletonPulse}`} style={{ height: 260 }} />
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div
            style={{
              padding: "16px 20px",
              background: "rgba(239, 127, 130, 0.15)",
              border: "1px solid rgba(239, 127, 130, 0.3)",
              borderRadius: "12px",
              color: "#ef7f82",
              marginBottom: "24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <AlertTriangle size={18} />
              <span>{error}</span>
            </div>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnDanger} ${styles.btnSmall}`}
              onClick={fetchData}
            >
              Retry
            </button>
          </div>
        )}

        {/* ============================================================
            TAB 1: COMMAND CENTER (HERO BENTO GRID)
            ============================================================ */}
        {activeTab === "OVERVIEW" && (
          <div className={styles.bentoGrid}>
            {/* ============================================================
                HERO ROW: 4 HIGH-IMPACT SAAS & COMMERCE KPI CARDS (Col 3 Each)
                ============================================================ */}

            {/* Hero Card 1: SaaS Financials & Monetization */}
            <div className={`${styles.bentoCard} ${styles.col3}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleArea}>
                  <span className={styles.cardMetaLabel}>SaaS Monetization</span>
                  <h3 className={styles.cardTitle}>
                    <CreditCard size={15} /> Platform MRR
                  </h3>
                </div>
                <span className={`${styles.statusPill} ${styles.statusPillLime}`}>BDT ACTIVE</span>
              </div>

              <div className={styles.cardHeroValue}>
                <span>{bdtOrDash(overview?.financials?.mrr_bdt)}</span>
                <span className={styles.cardHeroValueUnit}>/ mo</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginTop: "auto" }}>
                <div className={styles.statRow}>
                  <span>Annualized ARR</span>
                  <span className={styles.statValue}>{bdtOrDash(overview?.financials?.arr_bdt)}</span>
                </div>
                <div className={styles.statRow}>
                  <span>Active Subscriptions</span>
                  <span className={styles.statValue}>{subscriptions.filter((s) => s.status === "ACTIVE").length} paid</span>
                </div>
                <div className={styles.statRow}>
                  <span>Average ARPU</span>
                  <span className={styles.statValue}>{bdtOrDash(overview?.financials?.arpu_bdt)}</span>
                </div>
              </div>
            </div>

            {/* Hero Card 2: Platform Commerce Velocity (Cross-Tenant GMV) */}
            <div className={`${styles.bentoCard} ${styles.col3}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleArea}>
                  <span className={styles.cardMetaLabel}>Commerce Velocity</span>
                  <h3 className={styles.cardTitle}>
                    <ShoppingBag size={15} /> Cross-Tenant GMV
                  </h3>
                </div>
                <span className={`${styles.statusPill} ${styles.statusPillActive}`}>LIVE VOLUME</span>
              </div>

              <div className={styles.cardHeroValue}>
                <span>{bdtOrDash(overview?.commerce_velocity?.total_gmv_bdt)}</span>
                <span className={styles.cardHeroValueUnit}>total</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginTop: "auto" }}>
                <div className={styles.statRow}>
                  <span>Orders Processed</span>
                  <span className={styles.statValue}>{numOrDash(overview?.commerce_velocity?.total_orders_count)} orders</span>
                </div>
                <div className={styles.statRow}>
                  <span>Average Order Value</span>
                  <span className={styles.statValue}>{bdtOrDash(overview?.commerce_velocity?.avg_order_value_bdt)}</span>
                </div>
                <div className={styles.statRow}>
                  <span>Payment Mix</span>
                  <span className={styles.statValue}>
                    {pctOrDash(overview?.commerce_velocity?.cod_percentage)} COD • {pctOrDash(overview?.commerce_velocity?.digital_payment_percentage)} MFS
                  </span>
                </div>
              </div>
            </div>

            {/* Hero Card 3: Agentic Intelligence & LLM Fleet */}
            <div className={`${styles.bentoCard} ${styles.col3}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleArea}>
                  <span className={styles.cardMetaLabel}>Agentic Operations</span>
                  <h3 className={styles.cardTitle}>
                    <Bot size={15} /> AI Conversations
                  </h3>
                </div>
                <span className={`${styles.statusPill} ${styles.statusPillActive}`}>
                  {pctOrDash(overview?.ai_fleet?.autonomous_resolution_rate)} AUTO
                </span>
              </div>

              <div className={styles.cardHeroValue}>
                <span>{numOrDash(overview?.ai_fleet?.total_conversations)}</span>
                <span className={styles.cardHeroValueUnit}>handled</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginTop: "auto" }}>
                <div className={styles.statRow}>
                  <span>Autonomous Resolution</span>
                  <span className={styles.statValue}>{pctOrDash(overview?.ai_fleet?.autonomous_resolution_rate)} completed</span>
                </div>
                <div className={styles.statRow}>
                  <span>Token Consumption</span>
                  <span className={styles.statValue}>
                    {typeof overview?.ai_fleet?.total_tokens === "number" ? (overview.ai_fleet.total_tokens / 1000).toFixed(1) + "k" : "—"} tokens
                  </span>
                </div>
                <div className={styles.statRow}>
                  <span>Est. AI Cloud Cost</span>
                  <span className={styles.statValue}>
                    {bdtOrDash(overview?.ai_fleet?.estimated_cost_bdt)}
                  </span>
                </div>
              </div>
            </div>

            {/* Hero Card 4: Platform Engine & Automation Reliability */}
            <div className={`${styles.bentoCard} ${styles.col3}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleArea}>
                  <span className={styles.cardMetaLabel}>Engine Telemetry</span>
                  <h3 className={styles.cardTitle}>
                    <Zap size={15} /> Automation Pulse
                  </h3>
                </div>
                <span
                  className={`${styles.statusPill} ${
                    killSwitches.some((k) => k.is_active) ? styles.statusPillEngaged : styles.statusPillArmed
                  }`}
                >
                  {killSwitches.some((k) => k.is_active) ? "KILL SWITCH ENGAGED" : "PROTECTED"}
                </span>
              </div>

              <div className={styles.cardHeroValue}>
                <span>{pctOrDash(overview?.automation_health?.success_rate_percent)}</span>
                <span className={styles.cardHeroValueUnit}>healthy</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginTop: "auto" }}>
                <div className={styles.statRow}>
                  <span>Workflow Executions</span>
                  <span className={styles.statValue}>{numOrDash(overview?.automation_health?.total_executions)} executions</span>
                </div>
                <div className={styles.statRow}>
                  <span>Active Worker Nodes</span>
                  <span className={styles.statValue}>
                    {n8nCluster?.nodes?.filter((n: any) => n.status === "HEALTHY").length ?? 0} / {n8nCluster?.nodes?.length ?? 0} online
                  </span>
                </div>
                <div className={styles.statRow}>
                  <span>Pipeline Integrity</span>
                  <span className={styles.statValue}>
                    {(overview?.automation_health?.dlq_items_count ?? 0) === 0 ? "0 DLQ Drops (Normal)" : `${overview?.automation_health?.dlq_items_count} in DLQ (Review)`}
                  </span>
                </div>
              </div>
            </div>

            {/* Middle Card 1 (Span 7): Ecosystem & Bangladeshi Provider Rails */}
            <div className={`${styles.bentoCard} ${styles.col7}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleArea}>
                  <span className={styles.cardMetaLabel}>Ecosystem Telemetry</span>
                  <h3 className={styles.cardTitle}>
                    <Radio size={15} /> Bangladeshi Commerce Rails & Provider Heartbeat
                  </h3>
                  <span className={styles.cardSubtitle}>Real-time health of courier webhooks, MFS payment gateways, and social APIs</span>
                </div>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
                  onClick={() => setActiveTab("HEALTH")}
                >
                  <span>Health Center →</span>
                </button>
              </div>

              {incidents.filter((i) => i.status !== "RESOLVED" && i.status !== "CLOSED").length > 0 && (
                <div style={{ marginBottom: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  {incidents.filter((i) => i.status !== "RESOLVED" && i.status !== "CLOSED").slice(0, 2).map((inc) => (
                    <div
                      key={inc.id}
                      className={styles.subCard}
                      style={{
                        padding: "8px 12px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        borderLeft: "3px solid #ef4444",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span className={`${styles.statusPill} ${styles.statusPillSuspended}`}>{inc.severity}</span>
                        <span style={{ fontSize: "12px", fontWeight: 600 }}>{inc.title}</span>
                      </div>
                      <span className={styles.textMuted}>{inc.status}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className={styles.railsGrid}>
                {[
                  { name: "Steadfast Courier", detail: "Dispatch & tracking API", status: overview?.provider_health?.steadfast_status },
                  { name: "Pathao Logistics", detail: "Webhook delivery & rider sync", status: overview?.provider_health?.pathao_status },
                  { name: "bKash & Nagad MFS", detail: "Payment notifications", status: overview?.provider_health?.bkash_status },
                  { name: "Meta Graph API", detail: "WhatsApp Cloud & Messenger", status: overview?.provider_health?.meta_status },
                ].map((rail) => (
                  <div key={rail.name} className={styles.railCard}>
                    <div className={styles.railHeader}>
                      <span className={styles.railTitle}>
                        <span className={`${styles.statusDot} ${rail.status === "HEALTHY" ? styles.statusDotHealthy : ""}`} />
                        {rail.name}
                      </span>
                      <span className={`${styles.statusPill} ${rail.status === "HEALTHY" ? styles.statusPillActive : ""}`}>
                        {rail.status === "SIMULATED" ? "Simulated — not connected" : rail.status ?? "—"}
                      </span>
                    </div>
                    <div className={styles.railMeta}>
                      <span>{rail.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Middle Card 2 (Span 5): Security Posture & Fleet Distribution */}
            <div className={`${styles.bentoCard} ${styles.col5}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleArea}>
                  <span className={styles.cardMetaLabel}>Zero-Trust Governance</span>
                  <h3 className={styles.cardTitle}>
                    <Shield size={15} /> Platform Security & Fleet
                  </h3>
                  <span className={styles.cardSubtitle}>Operator access, MFA compliance, and workspace distribution</span>
                </div>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
                  onClick={() => setActiveTab("SECURITY")}
                >
                  <span>Security Center →</span>
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <div className={styles.statRow}>
                  <span className={styles.statLabel}>
                    <Store size={14} /> Workspace Fleet
                  </span>
                  <span className={styles.statValue}>
                    {tenants.filter((t) => t.status === "ACTIVE").length} Active • {tenants.filter((t) => t.status === "TRIAL").length} Trial • {tenants.filter((t) => t.status === "SUSPENDED").length} Suspended
                  </span>
                </div>
                <div className={styles.statRow}>
                  <span className={styles.statLabel}>
                    <UserCheck size={14} /> Platform Operators
                  </span>
                  <span className={styles.statValue}>{operators.length} active · {pctOrDash(overview?.security?.mfa_enforced_percent)} with MFA</span>
                </div>
                <div className={styles.statRow}>
                  <span className={styles.statLabel}>
                    <Eye size={14} /> Active Impersonations
                  </span>
                  <span className={styles.statValue}>
                    {impersonations.filter((i) => i.is_active).length > 0 ? (
                      <span className={`${styles.statusPill} ${styles.statusPillSuspended}`}>
                        {impersonations.filter((i) => i.is_active).length} AUDITED SESSION
                      </span>
                    ) : (
                      <span style={{ color: "#059669" }}>0 Active (Clean)</span>
                    )}
                  </span>
                </div>
                <div className={styles.statRow}>
                  <span className={styles.statLabel}>
                    <ScrollText size={14} /> Audit Trail (Forensics)
                  </span>
                  <span className={styles.statValue}>{auditLogs.length} verified events logged</span>
                </div>
              </div>
            </div>

            {/* Bottom Card 1 (Span 6): Quick Tenants Snapshot */}
            <div className={`${styles.bentoCard} ${styles.col6}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleArea}>
                  <span className={styles.cardMetaLabel}>Fleet Snapshot</span>
                  <h3 className={styles.cardTitle}>Recent Workspace Registrations</h3>
                </div>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
                  onClick={() => setActiveTab("TENANTS")}
                >
                  <span>View All {tenants.length} →</span>
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {tenants.slice(0, 4).map((t) => (
                  <div
                    key={t.id}
                    className={styles.subCard}
                    style={{
                      padding: "10px 14px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "#111827" }}>{t.name}</div>
                      <div className={styles.textMuted}>{t.slug} • {t.currency}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span
                        className={`${styles.statusPill} ${
                          t.status === "ACTIVE"
                            ? styles.statusPillActive
                            : t.status === "TRIAL"
                            ? styles.statusPillTrial
                            : styles.statusPillSuspended
                        }`}
                      >
                        {t.status}
                      </span>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
                        onClick={() => handleInspectTenant(t.id)}
                      >
                        Inspect
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom Card 2 (Span 6): Rapid Shortcuts */}
            <div className={`${styles.bentoCard} ${styles.col6}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleArea}>
                  <span className={styles.cardMetaLabel}>Platform Governance</span>
                  <h3 className={styles.cardTitle}>Privileged Operational Actions</h3>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSecondary}`}
                  style={{ justifyContent: "flex-start", padding: "14px" }}
                  onClick={() => setShowProvisionModal(true)}
                >
                  <Plus size={16} color="#059669" />
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontWeight: 600 }}>Provision Workspace</div>
                    <div className={styles.textMuted}>Onboard merchant store</div>
                  </div>
                </button>

                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSecondary}`}
                  style={{ justifyContent: "flex-start", padding: "14px" }}
                  onClick={() => setActiveTab("SAFETY")}
                >
                  <ShieldAlert size={16} color="#dc2626" />
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontWeight: 600 }}>Emergency Stop</div>
                    <div className={styles.textMuted}>Scoped kill switch</div>
                  </div>
                </button>

                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSecondary}`}
                  style={{ justifyContent: "flex-start", padding: "14px" }}
                  onClick={() => setShowStepUpModal(true)}
                >
                  <KeyRound size={16} color="#2563eb" />
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontWeight: 600 }}>Step-Up Elevation</div>
                    <div className={styles.textMuted}>Elevate privileged MFA</div>
                  </div>
                </button>

                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSecondary}`}
                  style={{ justifyContent: "flex-start", padding: "14px" }}
                  onClick={() => setActiveTab("AUDIT")}
                >
                  <Download size={16} color="#4b5563" />
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontWeight: 600 }}>Export Audit Ledger</div>
                    <div className={styles.textMuted}>SHA-256 verified logs</div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================
            TAB 2: TENANTS FLEET MANAGEMENT
            ============================================================ */}
        {activeTab === "TENANTS" && (
          <div>
            <div className={styles.filterBar}>
              <div className={styles.searchBox}>
                <Search size={15} color="#9A9D98" />
                <input
                  type="text"
                  placeholder="Search tenants by name, slug, or ID..."
                  value={tenantSearch}
                  onChange={(e) => setTenantSearch(e.target.value)}
                  className={styles.searchInput}
                />
              </div>

              <div className={styles.filterPills}>
                {(["ALL", "ACTIVE", "TRIAL", "SUSPENDED", "ARCHIVED"] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    className={`${styles.filterPillBtn} ${tenantStatusFilter === st ? styles.filterPillBtnActive : ""}`}
                    onClick={() => setTenantStatusFilter(st)}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Workspace</th>
                    <th>Slug / Identifier</th>
                    <th>Lifecycle State</th>
                    <th>Currency</th>
                    <th>Created</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTenants.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <div className={styles.emptyState}>
                          <Building2 size={24} />
                          <p className={styles.emptyTitle}>No matching tenant workspaces found</p>
                          <p className={styles.emptyText}>Adjust your search query or lifecycle filters.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredTenants.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <div className={styles.tableTenantName}>
                            <Building2 size={16} color="#c7f900" />
                            <span>{t.name}</span>
                          </div>
                        </td>
                        <td>
                          <span className={styles.tableTenantSlug}>{t.slug}</span>
                        </td>
                        <td>
                          <span
                            className={`${styles.statusPill} ${
                              t.status === "ACTIVE"
                                ? styles.statusPillActive
                                : t.status === "TRIAL"
                                ? styles.statusPillTrial
                                : t.status === "SUSPENDED"
                                ? styles.statusPillSuspended
                                : styles.statusPillArchived
                            }`}
                          >
                            {t.status}
                          </span>
                        </td>
                        <td>{t.currency || "BDT"}</td>
                        <td className={styles.textMuted} style={{ fontSize: "12px" }}>
                          {new Date(t.created_at).toLocaleDateString("en-GB")}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <div className={styles.tableActionGroup} style={{ justifyContent: "flex-end" }}>
                            <button
                              type="button"
                              className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
                              onClick={() => handleInspectTenant(t.id)}
                            >
                              Inspect
                            </button>

                            <button
                              type="button"
                              className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
                              onClick={() => setShowImpersonateModal(t.id)}
                              title="Governed Support Impersonation"
                            >
                              Impersonate
                            </button>

                            {t.status === "ACTIVE" ? (
                              <button
                                type="button"
                                className={`${styles.btn} ${styles.btnDanger} ${styles.btnSmall}`}
                                onClick={() => setShowSuspendModal(t.id)}
                              >
                                Suspend
                              </button>
                            ) : (
                              <button
                                type="button"
                                className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSmall}`}
                                onClick={() => handleActivateTenant(t.id)}
                              >
                                Activate
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ============================================================
            TAB 3: PLANS & BILLING
            ============================================================ */}
        {activeTab === "PLANS" && (
          <div className={styles.bentoGrid}>
            {plans.map((p) => (
              <div key={p.id} className={`${styles.bentoCard} ${styles.col4}`}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitleArea}>
                    <span className={styles.cardMetaLabel}>Tier {p.tier}</span>
                    <h3 className={styles.cardTitle}>{p.name}</h3>
                  </div>
                  <span className={`${styles.statusPill} ${p.is_active ? styles.statusPillActive : styles.statusPillArchived}`}>
                    {p.is_active ? "PUBLISHED" : "DRAFT"}
                  </span>
                </div>

                <div className={styles.cardHeroValue}>
                  <span>৳{(p.price_bdt ?? 0).toLocaleString("en-BD")}</span>
                  <span className={styles.cardHeroValueUnit}>/ mo</span>
                </div>

                <p className={styles.textMuted} style={{ minHeight: "36px" }}>{p.description}</p>

                <div style={{ display: "flex", flexDirection: "column", gap: "6px", borderTop: "1px solid rgba(0,0,0,0.06)", paddingTop: "12px" }}>
                  <div className={styles.statRow}>
                    <span>Billing Interval</span>
                    <span className={styles.statValue}>{p.billing_interval}</span>
                  </div>
                  <div className={styles.statRow}>
                    <span>Active Version</span>
                    <span className={styles.statValue}>v{p.active_version ?? 1}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ============================================================
            TAB 4: ENTITLEMENTS & FEATURE QUOTAS
            ============================================================ */}
        {activeTab === "ENTITLEMENTS" && (
          <div className={styles.bentoGrid}>
            <div className={`${styles.bentoCard} ${styles.col12}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleArea}>
                  <span className={styles.cardMetaLabel}>Feature Gates</span>
                  <h3 className={styles.cardTitle}>Platform Entitlements Catalog</h3>
                </div>
              </div>

              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Entitlement Key</th>
                      <th>Feature Name</th>
                      <th>Category</th>
                      <th>Value Type</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entitlements.map((e) => (
                      <tr key={e.id}>
                        <td style={{ fontFamily: "monospace", color: "#c7f900" }}>{e.key}</td>
                        <td style={{ fontWeight: 600 }}>{e.name}</td>
                        <td>
                          <span className={styles.roleTag}>{e.category}</span>
                        </td>
                        <td>{e.value_type}</td>
                        <td className={styles.textMuted}>{e.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================
            TAB 5: AUTOMATIONS & N8N FLEET
            ============================================================ */}
        {activeTab === "AUTOMATIONS" && (
          <div className={styles.bentoGrid}>
            <div className={`${styles.bentoCard} ${styles.col6}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleArea}>
                  <span className={styles.cardMetaLabel}>Worker Fleet</span>
                  <h3 className={styles.cardTitle}>n8n Cluster Nodes</h3>
                </div>
                <span className={`${styles.statusPill} ${styles.statusPillActive}`}>
                  {n8nCluster?.nodes?.length
                    ? `${n8nCluster.nodes.filter((n: any) => n.status === "HEALTHY").length} / ${n8nCluster.nodes.length} healthy`
                    : "No nodes registered"}
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {(n8nCluster?.nodes ?? []).map((node: any) => (
                  <div
                    key={node.id}
                    className={styles.subCard}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                      <span style={{ fontWeight: 600, fontSize: "13px" }}>{node.name}</span>
                      <span className={`${styles.statusPill} ${styles.statusPillActive}`}>{node.status}</span>
                    </div>
                    <div style={{ display: "flex", gap: "16px" }} className={styles.textMuted}>
                      <span>CPU: {pctOrDash(node.cpu_usage)}</span>
                      <span>RAM: {pctOrDash(node.memory_usage)}</span>
                      <span>Executions: {node.active_executions || 0}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className={`${styles.bentoCard} ${styles.col6}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleArea}>
                  <span className={styles.cardMetaLabel}>Dead-Letter Queue</span>
                  <h3 className={styles.cardTitle}>DLQ Failed Items</h3>
                </div>
                <span className={`${styles.statusPill} ${styles.statusPillActive}`}>0 PENDING</span>
              </div>

              <div className={styles.emptyState} style={{ padding: "40px 0" }}>
                <CheckCircle2 size={32} color="#48bb78" />
                <p className={styles.emptyTitle}>Dead-Letter Queue is Clean</p>
                <p className={styles.emptyText}>All async webhooks and n8n background workflows completed successfully.</p>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================
            TAB 6: HEALTH & INCIDENTS
            ============================================================ */}
        {activeTab === "HEALTH" && (
          <div className={styles.bentoGrid}>
            <div className={`${styles.bentoCard} ${styles.col12}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleArea}>
                  <span className={styles.cardMetaLabel}>Forensic Incident Timeline</span>
                  <h3 className={styles.cardTitle}>Platform Incidents</h3>
                </div>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnDanger}`}
                  onClick={() => setShowIncidentModal(true)}
                >
                  <AlertTriangle size={14} />
                  <span>Declare Incident</span>
                </button>
              </div>

              {incidents.length === 0 ? (
                <div className={styles.emptyState}>
                  <CheckCircle2 size={36} color="#48bb78" />
                  <p className={styles.emptyTitle}>Zero Operational Incidents</p>
                  <p className={styles.emptyText}>All SaaS platform services and n8n workers operating within SLA boundaries.</p>
                </div>
              ) : (
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Severity</th>
                        <th>Title</th>
                        <th>Component</th>
                        <th>Status</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {incidents.map((inc) => (
                        <tr key={inc.id}>
                          <td>
                            <span className={`${styles.statusPill} ${styles.statusPillSuspended}`}>{inc.severity}</span>
                          </td>
                          <td style={{ fontWeight: 600 }}>{inc.title}</td>
                          <td>{inc.affected_component}</td>
                          <td>{inc.status}</td>
                          <td className={styles.textMuted} style={{ fontSize: "12px" }}>
                            {new Date(inc.created_at).toLocaleTimeString("en-GB")}
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

        {/* ============================================================
            TAB 7: SAFETY & KILL SWITCHES
            ============================================================ */}
        {activeTab === "SAFETY" && (
          <div className={styles.bentoGrid}>
            <div className={`${styles.bentoCard} ${styles.col12}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleArea}>
                  <span className={styles.cardMetaLabel}>Emergency Governance</span>
                  <h3 className={styles.cardTitle}>Scoped Kill Switch Matrix</h3>
                </div>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnDanger}`}
                  onClick={() => setShowKillSwitchModal(true)}
                >
                  <ShieldAlert size={14} />
                  <span>Engage Emergency Stop</span>
                </button>
              </div>

              {killSwitches.length === 0 ? (
                <div className={styles.emptyState}>
                  <Shield size={36} color="#c7f900" />
                  <p className={styles.emptyTitle}>All Kill Switches Inactive</p>
                  <p className={styles.emptyText}>No emergency circuit breakers or tenant execution halts are active.</p>
                </div>
              ) : (
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Scope</th>
                        <th>Target ID</th>
                        <th>Reason</th>
                        <th>Engaged By</th>
                        <th>Status</th>
                        <th style={{ textAlign: "right" }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {killSwitches.map((k) => (
                        <tr key={k.id}>
                          <td>
                            <span className={styles.roleTag}>{k.scope}</span>
                          </td>
                          <td style={{ fontFamily: "monospace" }}>{k.target_id}</td>
                          <td>{k.reason}</td>
                          <td className={styles.textMuted} style={{ fontSize: "12px" }}>{k.engaged_by_user_id}</td>
                          <td>
                            <span className={`${styles.statusPill} ${k.is_active ? styles.statusPillEngaged : styles.statusPillArchived}`}>
                              {k.is_active ? "ENGAGED" : "CLEARED"}
                            </span>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {k.is_active && (
                              <button
                                type="button"
                                className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSmall}`}
                                onClick={() => handleDisengageKillSwitch(k.id)}
                              >
                                Disengage
                              </button>
                            )}
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

        {/* ============================================================
            TAB 8: SECURITY & SUPPORT IMPERSONATION
            ============================================================ */}
        {activeTab === "SECURITY" && (
          <div className={styles.bentoGrid}>
            <div className={`${styles.bentoCard} ${styles.col6}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleArea}>
                  <span className={styles.cardMetaLabel}>Operator Directory</span>
                  <h3 className={styles.cardTitle}>Platform Administrators</h3>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {operators.map((op) => (
                  <div
                    key={op.id}
                    className={styles.subCard}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "13px" }}>{op.name}</div>
                      <div className={styles.textMuted}>{op.email}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span className={styles.roleTag}>{op.platformRole || "OPERATOR"}</span>
                      <span className={`${styles.statusPill} ${styles.statusPillTrial}`} title="TOTP enrollment is not implemented yet (FX-15)">
                        NO MFA
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className={`${styles.bentoCard} ${styles.col6}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleArea}>
                  <span className={styles.cardMetaLabel}>Governed Access</span>
                  <h3 className={styles.cardTitle}>Active Support Impersonations</h3>
                </div>
              </div>

              {impersonations.filter((i) => i.is_active).length === 0 ? (
                <div className={styles.emptyState}>
                  <UserCheck size={32} color="#48bb78" />
                  <p className={styles.emptyTitle}>Zero Active Impersonation Sessions</p>
                  <p className={styles.emptyText}>All customer merchant stores are isolated with no active platform support sessions.</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {impersonations.filter((i) => i.is_active).map((imp) => (
                    <div
                      key={imp.id}
                      className={styles.subCard}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                        <span style={{ fontWeight: 600 }}>Tenant: {imp.tenant_id}</span>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnDanger} ${styles.btnSmall}`}
                          onClick={() => handleRevokeImpersonation(imp.id)}
                        >
                          Revoke
                        </button>
                      </div>
                      <div className={styles.textMuted}>
                        Ticket: {imp.ticket_id} • Mode: {imp.mode} • Operator: {imp.operator_user_id}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "AGENTS" && <AgentHealthPanel />}

        {/* ============================================================
            TAB 9: FORENSIC AUDIT LEDGER
            ============================================================ */}
        {activeTab === "AUDIT" && (
          <div>
            <div className={styles.filterBar}>
              <div className={styles.searchBox}>
                <Search size={15} color="#9A9D98" />
                <input
                  type="text"
                  placeholder="Filter forensic audit logs by action or actor..."
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  className={styles.searchInput}
                />
              </div>

              <button
                type="button"
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={() => {
                  const blob = new Blob([JSON.stringify(auditLogs, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `commerceos_audit_export_${Date.now()}.json`;
                  a.click();
                }}
              >
                <Download size={14} />
                <span>Export SHA-256 Ledger</span>
              </button>
            </div>

            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Action</th>
                    <th>Actor ID</th>
                    <th>Target Resource</th>
                    <th>IP / Details</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAudit.length === 0 ? (
                    <tr>
                      <td colSpan={5}>
                        <div className={styles.emptyState}>
                          <ScrollText size={24} />
                          <p className={styles.emptyTitle}>No matching audit records</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredAudit.map((log) => (
                      <tr key={log.id}>
                        <td className={styles.textMuted} style={{ fontSize: "11px", whiteSpace: "nowrap" }}>
                          {new Date(log.created_at).toLocaleString("en-GB")}
                        </td>
                        <td>
                          <span className={styles.roleTag}>{log.action}</span>
                        </td>
                        <td style={{ fontFamily: "monospace", fontSize: "11px" }}>{log.actor_id}</td>
                        <td style={{ fontSize: "12px" }}>{log.target_resource_id || "GLOBAL"}</td>
                        <td className={styles.textMuted} style={{ fontSize: "11px" }}>
                          {log.ip_address || "IP not recorded"} • {JSON.stringify(log.details || {})}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ============================================================
            TAB 10: SETTINGS & FEATURE FLAGS
            ============================================================ */}
        {activeTab === "SETTINGS" && (
          <div className={styles.bentoGrid}>
            <div className={`${styles.bentoCard} ${styles.col6}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleArea}>
                  <span className={styles.cardMetaLabel}>Global Configuration</span>
                  <h3 className={styles.cardTitle}>Platform System Parameters</h3>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {settings.map((s) => (
                  <div key={s.id} className={styles.statRow}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{s.key}</div>
                      <div className={styles.textMuted}>{s.description}</div>
                    </div>
                    <span className={styles.statValue}>{JSON.stringify(s.value)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className={`${styles.bentoCard} ${styles.col6}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleArea}>
                  <span className={styles.cardMetaLabel}>Canary Deployments</span>
                  <h3 className={styles.cardTitle}>Platform Feature Flags</h3>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {featureFlags.map((f) => (
                  <div
                    key={f.id}
                    className={styles.subCard}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                      <span className={styles.codeKey}>{f.key}</span>
                      <span className={`${styles.statusPill} ${f.enabled ? styles.statusPillActive : styles.statusPillArchived}`}>
                        {f.enabled ? "ENABLED" : "DISABLED"}
                      </span>
                    </div>
                    <div className={styles.textMuted}>
                      Rollout: {f.percentage}% • {f.description}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ============================================================
          TENANT DETAIL SLIDE-OVER DRAWER
          ============================================================ */}
      {isDetailOpen && (
        <div className={styles.overlay} onClick={() => setIsDetailOpen(false)}>
          <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span className={styles.cardMetaLabel}>Tenant Inspection</span>
                <h2 style={{ margin: "4px 0 0 0", fontSize: "20px" }}>{tenantDetail?.tenant?.name || selectedTenantId}</h2>
              </div>
              <button type="button" className={styles.modalCloseBtn} onClick={() => setIsDetailOpen(false)}>
                <X size={18} />
              </button>
            </div>

            {tenantDetail ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                <div className={styles.subCard}>
                  <div className={styles.statRow}>
                    <span>Slug</span>
                    <span className={styles.statValue}>{tenantDetail.tenant?.slug}</span>
                  </div>
                  <div className={styles.statRow}>
                    <span>Lifecycle Status</span>
                    <span className={`${styles.statusPill} ${styles.statusPillActive}`}>{tenantDetail.tenant?.status}</span>
                  </div>
                  <div className={styles.statRow}>
                    <span>Currency</span>
                    <span className={styles.statValue}>{tenantDetail.tenant?.currency}</span>
                  </div>
                  <div className={styles.statRow}>
                    <span>Timezone</span>
                    <span className={styles.statValue}>{tenantDetail.tenant?.timezone}</span>
                  </div>
                </div>

                <div>
                  <h4 style={{ margin: "0 0 10px 0", fontSize: "14px" }}>Active Subscription</h4>
                  <div className={styles.subCard}>
                    <div className={styles.statRow}>
                      <span>Plan</span>
                      <span className={styles.statValue}>{tenantDetail.subscription?.plan_id || "GROWTH"}</span>
                    </div>
                    <div className={styles.statRow}>
                      <span>Amount</span>
                      <span className={styles.statValue}>{bdtOrDash(tenantDetail.subscription?.amount_bdt)} / mo</span>
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    onClick={() => {
                      setIsDetailOpen(false);
                      setShowImpersonateModal(tenantDetail.tenant?.id);
                    }}
                  >
                    <UserCheck size={14} />
                    <span>Launch Support Impersonation</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.skeletonPulse} style={{ height: "300px" }} />
            )}
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL: PROVISION NEW TENANT
          ============================================================ */}
      {showProvisionModal && (
        <div className={styles.overlay} onClick={() => setShowProvisionModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h3 className={styles.modalTitle}>Provision New Merchant Workspace</h3>
                <p className={styles.modalSubtitle}>Create a clean, isolated multi-tenant store environment.</p>
              </div>
              <button type="button" className={styles.modalCloseBtn} onClick={() => setShowProvisionModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleProvisionTenant} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Store / Workspace Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Chittagong Mart"
                  value={provisionForm.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                    setProvisionForm((prev) => ({ ...prev, name, slug }));
                  }}
                  className={styles.formInput}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Workspace Slug (Unique Subdomain / ID)</label>
                <input
                  type="text"
                  required
                  placeholder="chittagong-mart"
                  value={provisionForm.slug}
                  onChange={(e) => setProvisionForm((prev) => ({ ...prev, slug: e.target.value }))}
                  className={styles.formInput}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>SaaS Plan Tier</label>
                <select
                  value={provisionForm.plan_id}
                  onChange={(e) => setProvisionForm((prev) => ({ ...prev, plan_id: e.target.value }))}
                  className={styles.formSelect}
                >
                  <option value="FREE">FREE (Community)</option>
                  <option value="STARTER">STARTER (৳1,499/mo)</option>
                  <option value="GROWTH">GROWTH (৳4,999/mo)</option>
                  <option value="PRO">PRO (৳12,999/mo)</option>
                  <option value="ENTERPRISE">ENTERPRISE (Custom)</option>
                </select>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Store Owner Full Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Tanvir Ahmed"
                    value={provisionForm.owner_name}
                    onChange={(e) => setProvisionForm((prev) => ({ ...prev, owner_name: e.target.value }))}
                    className={styles.formInput}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Store Owner Email</label>
                  <input
                    type="email"
                    required
                    placeholder="tanvir@merchant.com"
                    value={provisionForm.owner_email}
                    onChange={(e) => setProvisionForm((prev) => ({ ...prev, owner_email: e.target.value }))}
                    className={styles.formInput}
                  />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSecondary}`}
                  onClick={() => setShowProvisionModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
                  Provision Workspace
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL: SUSPEND TENANT (DANGER CONFIRMATION)
          ============================================================ */}
      {showSuspendModal && (
        <div className={styles.overlay} onClick={() => setShowSuspendModal(null)}>
          <div className={`${styles.modal} ${styles.modalDanger}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h3 className={styles.modalTitle} style={{ color: "#ef7f82" }}>
                  Confirm Tenant Suspension
                </h3>
                <p className={styles.modalSubtitle}>
                  This will immediately freeze customer checkouts, webhook triggers, and merchant access for this workspace.
                </p>
              </div>
              <button type="button" className={styles.modalCloseBtn} onClick={() => setShowSuspendModal(null)}>
                <X size={18} />
              </button>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Audit Justification Reason (Required)</label>
              <textarea
                required
                rows={3}
                placeholder="Detail the compliance violation, non-payment, or security incident..."
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                className={styles.formTextarea}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={() => setShowSuspendModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={handleSuspendTenant}
                disabled={!suspendReason.trim()}
              >
                Execute Suspension
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL: GOVERNED SUPPORT IMPERSONATION
          ============================================================ */}
      {showImpersonateModal && (
        <div className={styles.overlay} onClick={() => setShowImpersonateModal(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h3 className={styles.modalTitle}>Launch Governed Impersonation</h3>
                <p className={styles.modalSubtitle}>
                  Issue a cryptographically signed, time-bounded support token. Defaults to safe READ_ONLY inspection.
                </p>
              </div>
              <button type="button" className={styles.modalCloseBtn} onClick={() => setShowImpersonateModal(null)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateImpersonation} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Support Ticket ID (Required)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ZENDESK-8841"
                  value={impersonateTicket}
                  onChange={(e) => setImpersonateTicket(e.target.value)}
                  className={styles.formInput}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Operational Mode</label>
                <select
                  value={impersonateMode}
                  onChange={(e) => setImpersonateMode(e.target.value as any)}
                  className={styles.formSelect}
                >
                  <option value="READ_ONLY">READ_ONLY (Safe Default - mutations blocked)</option>
                  <option value="MUTATION_APPROVED">MUTATION_APPROVED (Requires explicit justification)</option>
                </select>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Reason for Customer Store Inspection</label>
                <textarea
                  required
                  rows={2}
                  placeholder="Detail the courier tracking or payment reconciliation issue..."
                  value={impersonateReason}
                  onChange={(e) => setImpersonateReason(e.target.value)}
                  className={styles.formTextarea}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSecondary}`}
                  onClick={() => setShowImpersonateModal(null)}
                >
                  Cancel
                </button>
                <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
                  Generate Token & Launch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL: EMERGENCY KILL SWITCH (TYPED MATCH CONFIRMATION)
          ============================================================ */}
      {showKillSwitchModal && (
        <div className={styles.overlay} onClick={() => setShowKillSwitchModal(false)}>
          <div className={`${styles.modal} ${styles.modalDanger}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h3 className={styles.modalTitle} style={{ color: "#ef7f82" }}>
                  Engage Scoped Emergency Stop
                </h3>
                <p className={styles.modalSubtitle}>
                  Immediately halt execution. This action will be recorded in the immutable platform ledger.
                </p>
              </div>
              <button type="button" className={styles.modalCloseBtn} onClick={() => setShowKillSwitchModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleEngageKillSwitch} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Emergency Scope</label>
                <select
                  value={killSwitchScope}
                  onChange={(e) => setKillSwitchScope(e.target.value as any)}
                  className={styles.formSelect}
                >
                  <option value="GLOBAL">GLOBAL (Halt non-essential platform background workers)</option>
                  <option value="TENANT">TENANT (Quarantine a single compromised workspace)</option>
                  <option value="WORKFLOW">WORKFLOW (Halt failing automation trigger)</option>
                </select>
              </div>

              {killSwitchScope !== "GLOBAL" && (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Target Resource ID</label>
                  <input
                    type="text"
                    required
                    placeholder={killSwitchScope === "TENANT" ? "ten_xxx" : "wf_xxx"}
                    value={killSwitchTargetId}
                    onChange={(e) => setKillSwitchTargetId(e.target.value)}
                    className={styles.formInput}
                  />
                </div>
              )}

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Audit Reason</label>
                <textarea
                  required
                  rows={2}
                  placeholder="Detail the active attack vector, loop execution, or data breach risk..."
                  value={killSwitchReason}
                  onChange={(e) => setKillSwitchReason(e.target.value)}
                  className={styles.formTextarea}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel} style={{ color: "#ef7f82" }}>
                  Typed Confirmation: Type &quot;CONFIRM KILL SWITCH&quot; to authorize
                </label>
                <input
                  type="text"
                  required
                  placeholder="CONFIRM KILL SWITCH"
                  value={killSwitchConfirmation}
                  onChange={(e) => setKillSwitchConfirmation(e.target.value)}
                  className={styles.formInput}
                  style={{ borderColor: "rgba(239, 127, 130, 0.4)" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSecondary}`}
                  onClick={() => setShowKillSwitchModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`${styles.btn} ${styles.btnDanger}`}
                  disabled={killSwitchConfirmation !== "CONFIRM KILL SWITCH"}
                >
                  ENGAGE EMERGENCY STOP
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL: DECLARE INCIDENT
          ============================================================ */}
      {showIncidentModal && (
        <div className={styles.overlay} onClick={() => setShowIncidentModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h3 className={styles.modalTitle}>Declare Platform Incident</h3>
                <p className={styles.modalSubtitle}>Publish an operational alert to the health status page.</p>
              </div>
              <button type="button" className={styles.modalCloseBtn} onClick={() => setShowIncidentModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleDeclareIncident} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Incident Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Degradation in bKash Webhook Processing"
                  value={incidentTitle}
                  onChange={(e) => setIncidentTitle(e.target.value)}
                  className={styles.formInput}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Severity</label>
                  <select
                    value={incidentSeverity}
                    onChange={(e) => setIncidentSeverity(e.target.value as any)}
                    className={styles.formSelect}
                  >
                    <option value="SEV1">SEV1 (Critical Outage)</option>
                    <option value="SEV2">SEV2 (Major Degradation)</option>
                    <option value="SEV3">SEV3 (Minor Flurry)</option>
                    <option value="SEV4">SEV4 (Maintenance / Informational)</option>
                  </select>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Affected Component</label>
                  <select
                    value={incidentComponent}
                    onChange={(e) => setIncidentComponent(e.target.value)}
                    className={styles.formSelect}
                  >
                    <option value="n8n_cluster">n8n Worker Cluster</option>
                    <option value="db_replica">Database Primary / Replica</option>
                    <option value="payment_gateway">bKash / Nagad Gateway</option>
                    <option value="courier_api">Steadfast / Pathao Courier API</option>
                    <option value="auth_service">Authentication & Token Issuer</option>
                  </select>
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Initial Diagnostic Update</label>
                <textarea
                  rows={3}
                  placeholder="Engineers are investigating latency spike..."
                  value={incidentDescription}
                  onChange={(e) => setIncidentDescription(e.target.value)}
                  className={styles.formTextarea}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSecondary}`}
                  onClick={() => setShowIncidentModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className={`${styles.btn} ${styles.btnDanger}`}>
                  Publish Incident
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL: STEP-UP MFA ELEVATION
          ============================================================ */}
      {showStepUpModal && (
        <div className={styles.overlay} onClick={() => setShowStepUpModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h3 className={styles.modalTitle}>Step-Up MFA Elevation</h3>
                <p className={styles.modalSubtitle}>
                  High-risk platform operations need a fresh code from your authenticator app. Elevation lasts 5
                  minutes.
                </p>
              </div>
              <button type="button" className={styles.modalCloseBtn} onClick={() => setShowStepUpModal(false)}>
                <X size={18} />
              </button>
            </div>

            {stepUpError && (
              <p className={styles.formHint} role="alert">
                {stepUpError}
              </p>
            )}

            {mfaEnrollment ? (
              <form onSubmit={handleConfirmMfaSetup} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>1. Add this key to your authenticator app</label>
                  <code style={{ wordBreak: "break-all", fontSize: "13px" }}>{mfaEnrollment.secret}</code>
                  <span className={styles.formHint}>
                    Or paste this setup link into an app that accepts one:{" "}
                    <code style={{ wordBreak: "break-all" }}>{mfaEnrollment.otpauth_uri}</code>
                  </span>
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>2. Enter the 6-digit code it shows</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="6-digit code"
                    value={mfaEnrollCode}
                    onChange={(e) => setMfaEnrollCode(e.target.value.replace(/\D/g, ""))}
                    className={styles.formInput}
                    autoFocus
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
                  <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => setMfaEnrollment(null)}>
                    Cancel
                  </button>
                  <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={mfaEnrollCode.length !== 6}>
                    Confirm authenticator
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleStepUpElevation} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>TOTP Authenticator Code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="6-digit code"
                    value={stepUpCode}
                    onChange={(e) => setStepUpCode(e.target.value.replace(/\D/g, ""))}
                    className={styles.formInput}
                    autoFocus
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
                  {mfaSetupNeeded && (
                    <>
                      <input
                        type="password"
                        autoComplete="current-password"
                        placeholder="Your password"
                        aria-label="Confirm your password to set up an authenticator"
                        value={mfaSetupPassword}
                        onChange={(e) => setMfaSetupPassword(e.target.value)}
                        className={styles.formInput}
                      />
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnSecondary}`}
                        onClick={handleStartMfaSetup}
                        disabled={!mfaSetupPassword}
                      >
                        Set up authenticator
                      </button>
                    </>
                  )}
                  <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => setShowStepUpModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={stepUpCode.length !== 6}>
                    Authorize Elevation
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ============================================================
          COMMAND PALETTE (⌘K / Ctrl+K)
          ============================================================ */}
      {showCommandPalette && (
        <div className={styles.overlay} onClick={() => setShowCommandPalette(false)}>
          <div className={`${styles.modal} ${styles.paletteModal}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.paletteSearchArea}>
              <Search size={18} color="#111827" />
              <input
                type="text"
                autoFocus
                placeholder="Type a platform command or navigate..."
                value={commandQuery}
                onChange={(e) => setCommandQuery(e.target.value)}
                className={styles.paletteSearchInput}
              />
              <span className={styles.textMuted}>ESC to exit</span>
            </div>

            <div className={styles.paletteResults}>
              {DOCK_ITEMS.filter((item) => item.label.toLowerCase().includes(commandQuery.toLowerCase())).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.paletteItem}
                  onClick={() => {
                    setActiveTab(item.id);
                    setShowCommandPalette(false);
                    setCommandQuery("");
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    {item.icon}
                    <span className={styles.paletteItemTitle}>{item.label}</span>
                  </div>
                  <span className={styles.paletteItemCategory}>View</span>
                </button>
              ))}

              <button
                type="button"
                className={styles.paletteItem}
                onClick={() => {
                  setShowCommandPalette(false);
                  setShowProvisionModal(true);
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <Plus size={16} color="#c7f900" />
                  <span className={styles.paletteItemTitle}>Provision New Tenant Workspace</span>
                </div>
                <span className={styles.paletteItemCategory}>Action</span>
              </button>

              <button
                type="button"
                className={styles.paletteItem}
                onClick={() => {
                  setShowCommandPalette(false);
                  setShowKillSwitchModal(true);
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <ShieldAlert size={16} color="#ef7f82" />
                  <span className={styles.paletteItemTitle}>Engage Scoped Emergency Stop</span>
                </div>
                <span className={styles.paletteItemCategory} style={{ color: "#ef7f82" }}>
                  Safety
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
