"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Workflow,
  Play,
  Pause,
  AlertTriangle,
  ShieldCheck,
  RefreshCw,
  Radio,
  Layers,
  Server,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Plus,
  ArrowRight,
  ShieldAlert,
  Zap,
  Database,
  UploadCloud,
  FileUp,
  FileText,
  Check,
  Trash2,
  RotateCcw,
  Truck,
  HelpCircle,
  Ruler,
  CreditCard,
  Store,
  ChevronDown,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge/Badge";
import styles from "./automations.module.css";
import {
  AutomationRecord,
  AutomationExecution,
  AutomationDeadLetter,
  AutomationHealth,
  StandardWorkflowTemplate,
  N8nInstance,
  WebhookProvider,
  WebhookSignatureAlgorithm,
} from "@/types/automation";

/** Row shape returned by GET /api/v1/automation/providers (webhooks). */
interface WebhookEndpointRow {
  id: string;
  provider: WebhookProvider;
  endpoint_path: string;
  ingress_path: string;
  secret_configured: boolean;
  signature_algorithm: WebhookSignatureAlgorithm;
  is_active: boolean;
  last_event_at?: string;
  failure_rate: number;
}

interface KnowledgeDoc {
  id: string;
  title: string;
  document_type: string;
  status: string;
  chunk_count: number;
  version: number;
  language: string;
  created_at: string;
}

interface DocCategoryOption {
  id: string;
  name: string;
  shortLabel: string;
  description: string;
  badge: string;
  icon: React.ElementType;
}

const DOCUMENT_CATEGORIES: DocCategoryOption[] = [
  {
    id: "RETURN_POLICY",
    name: "Return & Exchange Policy",
    shortLabel: "Return Policy",
    description: "Exchange time window (e.g. 7 days), unworn conditions, damage returns, refund options",
    badge: "Most Common",
    icon: RotateCcw,
  },
  {
    id: "SHIPPING_POLICY",
    name: "Shipping Rates & Delivery Times",
    shortLabel: "Shipping & Delivery",
    description: "Inside and outside Dhaka delivery charges from your settings, courier partners (Steadfast, Pathao), ETA",
    badge: "Essential",
    icon: Truck,
  },
  {
    id: "PRODUCT_FAQ",
    name: "Product FAQ & Care Instructions",
    shortLabel: "Product FAQ",
    description: "Fabric washing guide, material authenticity, warranty, care steps, manufacturer details",
    badge: "Customer Help",
    icon: HelpCircle,
  },
  {
    id: "SIZING_CHART",
    name: "Sizing Measurements & Charts",
    shortLabel: "Sizing Chart",
    description: "Chest, waist, length, and shoulder measurements in inches or centimeters (S, M, L, XL)",
    badge: "D2C Apparel",
    icon: Ruler,
  },
  {
    id: "PAYMENT_TERMS",
    name: "Payment & Cash on Delivery (COD)",
    shortLabel: "Payment & COD",
    description: "bKash / Nagad merchant payment guide, advance delivery fee rules, cash on delivery terms",
    badge: "Payments",
    icon: CreditCard,
  },
  {
    id: "WARRANTY",
    name: "Warranty & Guarantee Terms",
    shortLabel: "Warranty Terms",
    description: "Official warranty duration, replacement conditions, service centers across Bangladesh",
    badge: "Electronics & Items",
    icon: ShieldCheck,
  },
  {
    id: "BUSINESS_INFO",
    name: "Store Information & Working Hours",
    shortLabel: "Store Info",
    description: "Physical outlet location, customer support hotline, active response hours, social channels",
    badge: "Store Details",
    icon: Store,
  },
];

function CategoryDropdown({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const activeCategory = DOCUMENT_CATEGORIES.find((c) => c.id === selectedId) || DOCUMENT_CATEGORIES[0];
  const ActiveIcon = activeCategory.icon;

  return (
    <div className={styles.customSelectWrapper} ref={dropdownRef}>
      <button
        type="button"
        className={`${styles.customSelectTrigger} ${isOpen ? styles.customSelectTriggerOpen : ""}`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <div className={styles.triggerContent}>
          <div className={styles.triggerIconCircle}>
            <ActiveIcon size={16} />
          </div>
          <div className={styles.triggerTexts}>
            <span className={styles.triggerLabel}>{activeCategory.name}</span>
            <span className={styles.triggerHint}>{activeCategory.shortLabel}</span>
          </div>
        </div>
        <ChevronDown
          size={16}
          className={`${styles.chevronIcon} ${isOpen ? styles.chevronIconRotated : ""}`}
        />
      </button>

      {isOpen && (
        <div className={styles.customSelectMenu} role="listbox">
          <div className={styles.dropdownHeader}>
            <span>Document Category</span>
            <span className={styles.dropdownHeaderMeta}>{DOCUMENT_CATEGORIES.length} options</span>
          </div>
          <div className={styles.dropdownList}>
            {DOCUMENT_CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const isSelected = selectedId === cat.id;
              return (
                <div
                  key={cat.id}
                  role="option"
                  aria-selected={isSelected}
                  className={`${styles.customSelectItem} ${isSelected ? styles.customSelectItemActive : ""}`}
                  onClick={() => {
                    onSelect(cat.id);
                    setIsOpen(false);
                  }}
                >
                  <div className={styles.itemContent}>
                    <div className={`${styles.itemIconCircle} ${isSelected ? styles.itemIconCircleActive : ""}`}>
                      <Icon size={16} />
                    </div>
                    <div className={styles.itemTexts}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span className={styles.itemTitle}>{cat.name}</span>
                        <span className={styles.itemBadge}>{cat.badge}</span>
                      </div>
                      <span className={styles.itemDesc}>{cat.description}</span>
                    </div>
                  </div>
                  {isSelected && (
                    <div className={styles.selectedCheckCircle}>
                      <Check size={13} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

type ActiveTab =
  | "overview"
  | "automations"
  | "catalog"
  | "executions"
  | "knowledge";

const ROW: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "12px",
  background: "rgba(255,255,255,0.03)",
  borderRadius: "8px",
};

export default function AutomationsHubPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [health, setHealth] = useState<AutomationHealth | null>(null);
  const [automations, setAutomations] = useState<AutomationRecord[]>([]);
  const [templates, setTemplates] = useState<StandardWorkflowTemplate[]>([]);
  const [executions, setExecutions] = useState<AutomationExecution[]>([]);
  const [deadLetters, setDeadLetters] = useState<AutomationDeadLetter[]>([]);
  const [providersData, setProvidersData] = useState<{
    circuit_breakers: Record<string, { state: string; failures: number }>;
    n8n_instances: N8nInstance[];
    webhooks: WebhookEndpointRow[];
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Store Knowledge Base State
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDoc[]>([]);
  const [ragQuery, setRagQuery] = useState("");
  const [ragResults, setRagResults] = useState<any[]>([]);
  const [isSearchingRag, setIsSearchingRag] = useState(false);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [inferredTitle, setInferredTitle] = useState<string>("");
  const [inferredType, setInferredType] = useState<string>("RETURN_POLICY");
  const [isDragOver, setIsDragOver] = useState(false);
  const [pipelineStep, setPipelineStep] = useState<"IDLE" | "EXTRACTING" | "CHUNKING" | "EMBEDDING" | "STORING" | "DONE">("IDLE");
  const [pipelineStats, setPipelineStats] = useState<{ chunkCount?: number; docId?: string; error?: string } | null>(null);
  const [isDeletingDocId, setIsDeletingDocId] = useState<string | null>(null);
  const [isReindexingDocId, setIsReindexingDocId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [sessRes, healthRes, autoRes, tmplRes, execRes, dlqRes, provRes, knowRes] = await Promise.all([
        fetch("/api/v1/auth/session"),
        fetch("/api/v1/automation/health"),
        fetch("/api/v1/automations"),
        fetch("/api/v1/automation/templates"),
        fetch("/api/v1/automation/executions"),
        fetch("/api/v1/automation/dead-letters"),
        fetch("/api/v1/automation/providers"),
        fetch("/api/v1/ai/knowledge").catch(() => null),
      ]);

      if (sessRes.ok) {
        const sJson = await sessRes.json();
        const role = sJson.data?.role;
        if (role && !["OWNER", "ADMIN", "DEV"].includes(role)) {
          setError("NO_PERMISSION");
          return;
        }
      }

      if (healthRes.status === 401 || autoRes.status === 401) {
        setError("UNAUTHORIZED");
        return;
      }
      if (healthRes.status === 403 || autoRes.status === 403) {
        setError("NO_PERMISSION");
        return;
      }

      const healthJson = await healthRes.json();
      const autoJson = await autoRes.json();
      const tmplJson = await tmplRes.json();
      const execJson = await execRes.json();
      const dlqJson = await dlqRes.json();
      const provJson = await provRes.json();

      if (healthJson.data?.health) setHealth(healthJson.data.health);
      if (autoJson.data?.automations) setAutomations(autoJson.data.automations);
      if (tmplJson.data?.templates) setTemplates(tmplJson.data.templates);
      if (execJson.data?.executions) setExecutions(execJson.data.executions);
      if (dlqJson.data?.deadLetters) setDeadLetters(dlqJson.data.deadLetters);
      if (provJson.data) setProvidersData(provJson.data);
      if (knowRes && knowRes.ok) {
        const kJson = await knowRes.json();
        if (kJson.data) setKnowledgeDocs(kJson.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load automation data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    if (typeof window !== "undefined") {
      const tab = new URLSearchParams(window.location.search).get("tab");
      if (tab === "knowledge") {
        setActiveTab("knowledge");
      }
    }
  }, []);

  const handleToggleAutomation = async (id: string, currentEnabled: boolean) => {
    try {
      setActionLoading(id);
      const action = currentEnabled ? "disable" : "enable";
      await fetch(`/api/v1/automations/${id}/${action}`, { method: "POST" });
      await fetchData();
    } catch (err) {
      alert("Error toggling automation: " + (err instanceof Error ? err.message : ""));
    } finally {
      setActionLoading(null);
    }
  };

  const handleInstallTemplate = async (templateId: string) => {
    try {
      setActionLoading(templateId);
      const res = await fetch(`/api/v1/automation/templates/${templateId}/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Template installation failed");
      alert("Workflow template installed successfully!");
      setActiveTab("automations");
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error installing template");
    } finally {
      setActionLoading(null);
    }
  };

  const handleTestAutomation = async (id: string, dryRun = true) => {
    try {
      setActionLoading(id);
      const res = await fetch(`/api/v1/automations/${id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: dryRun }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Execution failed");
      alert(`Test ${dryRun ? "(DRY RUN)" : ""} completed! Status: ${data.data?.execution?.status}`);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error executing test");
    } finally {
      setActionLoading(null);
    }
  };


  const handleKillSwitch = async (action: "TRIP_KILL_SWITCH" | "RESUME_KILL_SWITCH") => {
    try {
      setActionLoading("KILL_SWITCH");
      await fetch("/api/v1/automation/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, scope: "TENANT", reason: "Operator manual toggle" }),
      });
      await fetchData();
    } catch (err) {
      alert("Error triggering kill switch");
    } finally {
      setActionLoading(null);
    }
  };

  // Handle File Selection & Auto-Extraction for Store Knowledge Base
  const handleFileSelect = (file: File) => {
    if (!/\.(txt|md|csv|json)$/i.test(file.name)) {
      alert("Only .txt, .md, .csv and .json files can be added for now. Save PDF or Word documents as text first.");
      return;
    }
    setSelectedFile(file);
    setPipelineStep("IDLE");
    setPipelineStats(null);

    let cleanTitle = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]+/g, " ");
    cleanTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);
    setInferredTitle(cleanTitle);

    const lower = file.name.toLowerCase();
    let cat = "RETURN_POLICY";
    if (lower.includes("shipping") || lower.includes("delivery") || lower.includes("courier")) {
      cat = "SHIPPING_POLICY";
    } else if (lower.includes("size") || lower.includes("chart") || lower.includes("measurement") || lower.includes("dimension")) {
      cat = "SIZING_CHART";
    } else if (lower.includes("faq") || lower.includes("care") || lower.includes("question") || lower.includes("fabric")) {
      cat = "PRODUCT_FAQ";
    } else if (lower.includes("pay") || lower.includes("bkash") || lower.includes("nagad") || lower.includes("cod") || lower.includes("refund")) {
      cat = "PAYMENT_TERMS";
    }
    setInferredType(cat);

    const reader = new FileReader();
    reader.onload = (e) => {
      setFileContent((e.target?.result as string) || "");
    };
    reader.onerror = () => {
      alert("Failed to read file.");
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleProcessAndIngest = async () => {
    if (!selectedFile) {
      alert("Please select a file first.");
      return;
    }
    if (!fileContent.trim()) {
      alert("The selected file contains no readable text.");
      return;
    }

    try {
      setPipelineStep("EXTRACTING");
      await new Promise((r) => setTimeout(r, 450));

      setPipelineStep("CHUNKING");
      await new Promise((r) => setTimeout(r, 450));

      setPipelineStep("EMBEDDING");

      const fileExt = selectedFile.name.split(".").pop()?.toUpperCase() || "TEXT";
      const fileFormat =
        fileExt === "MD" ? "MARKDOWN" : fileExt === "JSON" ? "JSON" : fileExt === "CSV" ? "CSV" : "TXT";

      const res = await fetch("/api/v1/ai/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: inferredTitle.trim() || selectedFile.name,
          document_type: inferredType,
          raw_content: fileContent,
          file_format: fileFormat,
          tags: ["file-upload", fileExt.toLowerCase()],
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || "Failed to process and embed document");
      }

      setPipelineStep("STORING");
      const data = await res.json();
      await new Promise((r) => setTimeout(r, 350));

      setPipelineStep("DONE");
      setPipelineStats({
        chunkCount: data.data?.chunk_count || 1,
        docId: data.data?.id,
      });

      fetchData();
    } catch (err: any) {
      setPipelineStep("IDLE");
      setPipelineStats({ error: err.message });
      alert("Pipeline Error: " + err.message);
    }
  };

  const handleResetFile = () => {
    setSelectedFile(null);
    setFileContent("");
    setInferredTitle("");
    setPipelineStep("IDLE");
    setPipelineStats(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDeleteDocument = async (id: string) => {
    if (!confirm("Are you sure you want to delete this document from the vector database?")) return;
    try {
      setIsDeletingDocId(id);
      const res = await fetch(`/api/v1/ai/knowledge/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete document");
      setKnowledgeDocs((prev) => prev.filter((d) => d.id !== id));
    } catch (err: any) {
      alert("Delete failed: " + err.message);
    } finally {
      setIsDeletingDocId(null);
    }
  };

  const handleReindexDocument = async (id: string) => {
    try {
      setIsReindexingDocId(id);
      const res = await fetch(`/api/v1/ai/knowledge/${id}/reindex`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to re-index document");
      const d = await res.json();
      setKnowledgeDocs((prev) => prev.map((doc) => (doc.id === id ? { ...doc, ...d.data } : doc)));
      alert("Document re-indexed.");
    } catch (err: any) {
      alert("Re-index failed: " + err.message);
    } finally {
      setIsReindexingDocId(null);
    }
  };

  const handleSearchRag = async () => {
    if (!ragQuery.trim()) return;
    try {
      setIsSearchingRag(true);
      const res = await fetch("/api/v1/ai/knowledge/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: ragQuery.trim(), limit: 4, threshold: 0.5 }),
      });
      if (res.ok) {
        const d = await res.json();
        setRagResults(d.data || []);
      }
    } finally {
      setIsSearchingRag(false);
    }
  };

  // UX Error & Access States
  if (error === "UNAUTHORIZED") {
    return (
      <div className={styles.container}>
        <div className={styles.card} style={{ textAlign: "center", padding: "60px 20px" }}>
          <AlertTriangle size={48} color="#f87171" style={{ margin: "0 auto 16px" }} />
          <h2>Authentication Required</h2>
          <p style={{ color: "#9ca3af" }}>Please sign in to access the Automation & n8n Hub.</p>
        </div>
      </div>
    );
  }

  if (error === "NO_PERMISSION") {
    return (
      <div className={styles.container}>
        <div className={styles.card} style={{ textAlign: "center", padding: "60px 20px" }}>
          <ShieldAlert size={48} color="var(--color-warning, #fbbf24)" style={{ margin: "0 auto 16px" }} />
          <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px" }}>Automations & n8n Hub Restricted</h2>
          <p style={{ color: "var(--color-text-secondary, #70736F)", maxWidth: "480px", margin: "0 auto 20px" }}>
            Workflow automation and n8n orchestration are restricted to Administrators and Super Admins. Please contact your workspace administrator to modify workflows or trigger conditions.
          </p>
          <button
            className={styles.btnSecondary}
            onClick={() => router.push("/")}
            style={{ margin: "0 auto" }}
          >
            Return to Overview
          </button>
        </div>
      </div>
    );
  }

  const filteredTemplates = templates.filter((t) => {
    const matchesCat = categoryFilter === "ALL" || t.category === categoryFilter;
    const matchesSearch =
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h1>
            <Workflow size={32} color="#c7f900" />
            Automations & n8n Hub
          </h1>
          <p className={styles.headerSubtitle}>
            Governed event routing, n8n orchestration, cryptographic webhooks, and authoritative idempotency.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={fetchData} disabled={loading}>
            <RefreshCw size={15} className={loading ? "spin" : ""} />
            Refresh
          </button>
          {health?.kill_switch_active ? (
            <button
              className={styles.btnPrimary}
              onClick={() => handleKillSwitch("RESUME_KILL_SWITCH")}
              disabled={actionLoading === "KILL_SWITCH"}
            >
              <Play size={15} /> Resume Automations
            </button>
          ) : (
            <button
              className={styles.btnDanger}
              onClick={() => handleKillSwitch("TRIP_KILL_SWITCH")}
              disabled={actionLoading === "KILL_SWITCH"}
            >
              <Pause size={15} /> Emergency Kill Switch
            </button>
          )}
        </div>
      </div>

      {/* Kill Switch Active Warning Banner */}
      {health?.kill_switch_active && (
        <div className={styles.killSwitchBanner}>
          <div>
            <div className={styles.killSwitchTitle}>
              <AlertTriangle size={18} /> Emergency Kill Switch Active
            </div>
            <p className={styles.killSwitchSubtitle}>
              All tenant automation executions are halted. Reason: {health.kill_switch_reason || "Emergency pause"}.
            </p>
          </div>
          <button className={styles.btnPrimary} onClick={() => handleKillSwitch("RESUME_KILL_SWITCH")}>
            Resume All
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className={styles.tabsContainer}>
        <button
          className={`${styles.tabButton} ${activeTab === "overview" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          <Activity size={16} /> Overview
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === "automations" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("automations")}
        >
          <Workflow size={16} /> Automations <span className={styles.tabBadge}>{automations.length}</span>
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === "catalog" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("catalog")}
        >
          <Layers size={16} /> Workflow Catalog <span className={styles.tabBadge}>39</span>
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === "executions" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("executions")}
        >
          <Clock size={16} /> Executions <span className={styles.tabBadge}>{executions.length}</span>
        </button>

        <button
          className={`${styles.tabButton} ${activeTab === "knowledge" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("knowledge")}
        >
          <Database size={16} /> Store Knowledge Base{" "}
          <span className={styles.tabBadge}>{knowledgeDocs.length}</span>
        </button>
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === "overview" && (
        <>
          <div className={styles.bentoGrid}>
            <div className={`${styles.kpiCard} ${styles.col3}`}>
              <div className={styles.kpiHeader}>
                <span>Active Automations</span>
                <Workflow size={18} color="#c7f900" />
              </div>
              <div className={styles.kpiValue}>{health?.active_automations_count || 0}</div>
              <div className={`${styles.kpiTrend} ${styles.kpiLime}`}>Live in production</div>
            </div>
            <div className={`${styles.kpiCard} ${styles.col3}`}>
              <div className={styles.kpiHeader}>
                <span>Executions Today</span>
                <Clock size={18} color="#9ca3af" />
              </div>
              <div className={styles.kpiValue}>{health?.executions_today || 0}</div>
              <div className={`${styles.kpiTrend} ${styles.kpiGreen}`}>
                {typeof health?.success_rate === "number" ? `${Math.round(health.success_rate * 100)}% Success rate` : "No runs yet"}
              </div>
            </div>
            <div className={`${styles.kpiCard} ${styles.col3}`}>
              <div className={styles.kpiHeader}>
                <span>Queue Depth & Retries</span>
                <Radio size={18} color="#fbbf24" />
              </div>
              <div className={styles.kpiValue}>{health?.queue_depth || 0}</div>
              <div className={`${styles.kpiTrend} ${styles.kpiYellow}`}>Bounded backoff</div>
            </div>
            <div className={`${styles.kpiCard} ${styles.col3}`}>
              <div className={styles.kpiHeader}>
                <span>Dead Letters (DLQ)</span>
                <AlertTriangle size={18} color="#f87171" />
              </div>
              <div className={styles.kpiValue}>{health?.dead_letter_count || 0}</div>
              <div className={`${styles.kpiTrend} ${styles.kpiRed}`}>Requires resolution</div>
            </div>
          </div>

          <div className={styles.bentoGrid}>
            <div className={`${styles.card} ${styles.col8}`}>
              <div className={styles.cardHeader}>
                <div>
                  <h3 className={styles.cardTitle}>Recent Executions</h3>
                  <p className={styles.cardSubtitle}>Real-time trace timeline and status verification</p>
                </div>
                <button className={styles.btnSecondary} onClick={() => setActiveTab("executions")}>
                  View All
                </button>
              </div>
              <div className={styles.tableContainer}>
                {executions.length === 0 ? (
                  <div className={styles.emptyState}>
                    <Clock size={32} />
                    <div className={styles.emptyStateTitle}>No Executions Yet</div>
                    <p className={styles.emptyStateText}>Trigger an event or run a dry-run test to see traces.</p>
                  </div>
                ) : (
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Execution ID</th>
                        <th>Status</th>
                        <th>Mode</th>
                        <th>Correlation ID</th>
                        <th>Duration</th>
                        <th>Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {executions.slice(0, 5).map((e) => (
                        <tr key={e.id}>
                          <td style={{ fontFamily: "monospace", color: "#c7f900" }}>{e.id.slice(0, 16)}</td>
                          <td>
                            <span
                              className={`${styles.badge} ${
                                e.status === "SUCCESS"
                                  ? styles.badgeSuccess
                                  : e.status === "FAILED" || e.status === "DEAD_LETTERED"
                                  ? styles.badgeFailed
                                  : styles.badgeWarning
                              }`}
                            >
                              {e.status}
                            </span>
                          </td>
                          <td>
                            <span className={`${styles.badge} ${styles.badgeMuted}`}>{e.execution_mode}</span>
                          </td>
                          <td style={{ fontFamily: "monospace" }}>{e.correlation_id || "-"}</td>
                          <td>{e.duration_ms ? `${e.duration_ms}ms` : "<10ms"}</td>
                          <td style={{ color: "#9ca3af" }}>{new Date(e.created_at).toLocaleTimeString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className={`${styles.card} ${styles.col4}`}>
              <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>Provider & n8n Health</h3>
              </div>
              {/* From the providers endpoint. This card used to show fixed HEALTHY/CONNECTED badges for n8n, Steadfast,
                  Pathao, bKash and "HMAC VERIFIED" whatever the real state was (FX-31). */}
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {(providersData?.n8n_instances ?? []).length === 0 ? (
                  <div style={ROW}>
                    <span style={{ fontWeight: 600 }}>n8n</span>
                    <span className={`${styles.badge} ${styles.badgeMuted}`}>NOT CONFIGURED</span>
                  </div>
                ) : (
                  (providersData?.n8n_instances ?? []).map((inst) => (
                    <div key={inst.id} style={ROW}>
                      <span style={{ fontWeight: 600 }}>{inst.name}</span>
                      <span className={`${styles.badge} ${inst.status === "ACTIVE" ? styles.badgeActive : styles.badgeMuted}`}>{inst.status}</span>
                    </div>
                  ))
                )}
                {Object.entries(providersData?.circuit_breakers ?? {}).map(([key, stat]) => (
                  <div key={key} style={ROW}>
                    <span style={{ fontWeight: 600 }}>{key} circuit</span>
                    <span className={`${styles.badge} ${stat.state === "CLOSED" ? styles.badgeSuccess : styles.badgeWarning}`}>{stat.state}</span>
                  </div>
                ))}
                <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                  Couriers and payment gateways aren&apos;t connected through automations yet; see the Connector Hub for saved credentials.
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* TAB 2: AUTOMATIONS */}
      {activeTab === "automations" && (
        <div className={styles.card}>
          <div className={styles.filterBar}>
            <div style={{ display: "flex", gap: "12px" }}>
              <input
                type="text"
                placeholder="Search automations..."
                className={styles.searchInput}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <select
                className={styles.selectInput}
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="ALL">All Categories</option>
                <option value="ORDER">Orders</option>
                <option value="PAYMENT">Payments</option>
                <option value="INVENTORY">Inventory</option>
                <option value="SHIPPING">Shipping</option>
                <option value="MARKETING">Marketing</option>
              </select>
            </div>
            <button className={styles.btnPrimary} onClick={() => setActiveTab("catalog")}>
              <Plus size={15} /> Install from Catalog
            </button>
          </div>

          <div className={styles.tableContainer}>
            {automations.length === 0 ? (
              <div className={styles.emptyState}>
                <Workflow size={32} />
                <div className={styles.emptyStateTitle}>No Installed Automations</div>
                <p className={styles.emptyStateText}>
                  Explore the 39 standard templates and install workflows for your workspace.
                </p>
                <button
                  className={styles.btnPrimary}
                  style={{ marginTop: "16px" }}
                  onClick={() => setActiveTab("catalog")}
                >
                  Browse Catalog
                </button>
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Automation Name</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Mode</th>
                    <th>Trigger</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {automations.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <strong style={{ color: "#ffffff" }}>{a.name}</strong>
                        <div style={{ fontSize: "11px", color: "#9ca3af" }}>{a.id}</div>
                      </td>
                      <td>
                        <span className={`${styles.badge} ${styles.badgeMuted}`}>{a.category}</span>
                      </td>
                      <td>
                        <span
                          className={`${styles.badge} ${
                            a.status === "ACTIVE"
                              ? styles.badgeActive
                              : a.status === "PAUSED"
                              ? styles.badgeWarning
                              : styles.badgeMuted
                          }`}
                        >
                          {a.status}
                        </span>
                      </td>
                      <td>
                        <span className={`${styles.badge} ${styles.badgeMuted}`}>{a.execution_mode}</span>
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: "12px" }}>{a.trigger_type}</td>
                      <td>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button
                            className={`${styles.btnSecondary} ${styles.btnSmall}`}
                            onClick={() => handleToggleAutomation(a.id, a.enabled)}
                            disabled={actionLoading === a.id}
                          >
                            {a.enabled ? <Pause size={12} /> : <Play size={12} />}
                            {a.enabled ? "Disable" : "Enable"}
                          </button>
                          <button
                            className={`${styles.btnSecondary} ${styles.btnSmall}`}
                            onClick={() => handleTestAutomation(a.id, true)}
                            disabled={actionLoading === a.id}
                          >
                            Dry Run
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: WORKFLOW CATALOG (39 TEMPLATES) */}
      {activeTab === "catalog" && (
        <>
          <div className={styles.filterBar}>
            <div style={{ display: "flex", gap: "12px" }}>
              <input
                type="text"
                placeholder="Search 39 templates by name or code..."
                className={styles.searchInput}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <select
                className={styles.selectInput}
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="ALL">All Categories (39)</option>
                <option value="ORDER">Order Automation (01-05)</option>
                <option value="PAYMENT">Payment Automation (06-10)</option>
                <option value="INVENTORY">Inventory Automation (11-15)</option>
                <option value="SHIPPING">Shipping & Courier (16-22)</option>
                <option value="CUSTOMER">Customer Automation (23-27)</option>
                <option value="SOCIAL">Social / Lead Automation (28-30)</option>
                <option value="MARKETING">Marketing Automation (31-34)</option>
                <option value="FINANCE_OPERATIONS">Finance & Operations (35-39)</option>
              </select>
            </div>
            <div style={{ fontSize: "13px", color: "#9ca3af" }}>
              Showing <strong>{filteredTemplates.length}</strong> of 39 standard workflows
            </div>
          </div>

          <div className={styles.bentoGrid}>
            {filteredTemplates.map((t) => (
              <div key={t.id} className={`${styles.col4}`}>
                <div className={styles.templateCard}>
                  <div>
                    <div className={styles.templateHeader}>
                      <span className={styles.templateCode}>{t.code}</span>
                      <span
                        className={`${styles.badge} ${
                          t.risk_level === "LOW"
                            ? styles.badgeSuccess
                            : t.risk_level === "MEDIUM"
                            ? styles.badgeWarning
                            : styles.badgeFailed
                        }`}
                      >
                        {t.risk_level} RISK
                      </span>
                    </div>
                    <div className={styles.templateTitle}>{t.name}</div>
                    <div className={styles.templateDescription}>{t.description}</div>
                  </div>
                  <div>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
                      {t.supported_channels.map((ch) => (
                        <span key={ch} className={`${styles.badge} ${styles.badgeMuted}`}>
                          {ch}
                        </span>
                      ))}
                    </div>
                    <div className={styles.templateFooter}>
                      <span style={{ fontSize: "11px", color: "#9ca3af" }}>
                        Trigger: {t.trigger_event || t.cron_schedule || "Manual"}
                      </span>
                      <button
                        className={styles.btnPrimary}
                        onClick={() => handleInstallTemplate(t.id)}
                        disabled={actionLoading === t.id}
                      >
                        Install <ArrowRight size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* TAB 4: EXECUTIONS */}
      {activeTab === "executions" && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h3 className={styles.cardTitle}>Execution Traces</h3>
              <p className={styles.cardSubtitle}>Complete step-level telemetry and verification logs</p>
            </div>
            <button className={styles.btnSecondary} onClick={fetchData}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
          <div className={styles.tableContainer}>
            {executions.length === 0 ? (
              <div className={styles.emptyState}>
                <Clock size={32} />
                <div className={styles.emptyStateTitle}>No Execution Traces</div>
                <p className={styles.emptyStateText}>Executions will appear here when events are ingested.</p>
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Execution ID</th>
                    <th>Automation</th>
                    <th>Status</th>
                    <th>Mode</th>
                    <th>Correlation ID</th>
                    <th>Causation ID</th>
                    <th>Duration</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {executions.map((e) => (
                    <tr key={e.id}>
                      <td style={{ fontFamily: "monospace", color: "#c7f900" }}>{e.id}</td>
                      <td>{e.automation_id}</td>
                      <td>
                        <span
                          className={`${styles.badge} ${
                            e.status === "SUCCESS"
                              ? styles.badgeSuccess
                              : e.status === "FAILED" || e.status === "DEAD_LETTERED"
                              ? styles.badgeFailed
                              : styles.badgeWarning
                          }`}
                        >
                          {e.status}
                        </span>
                      </td>
                      <td>
                        <span className={`${styles.badge} ${styles.badgeMuted}`}>{e.execution_mode}</span>
                      </td>
                      <td style={{ fontFamily: "monospace" }}>{e.correlation_id || "-"}</td>
                      <td style={{ fontFamily: "monospace" }}>{e.causation_id ? e.causation_id.slice(0, 16) : "-"}</td>
                      <td>{e.duration_ms ? `${e.duration_ms}ms` : "<10ms"}</td>
                      <td style={{ color: "#9ca3af" }}>{new Date(e.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: STORE KNOWLEDGE BASE (RAG) */}
      {activeTab === "knowledge" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          {/* Ingestion & Documents Column */}
          <div>
            <div className={styles.formCard} style={{ marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <UploadCloud size={20} color="#242529" />
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                  Upload Policy Document
                </h3>
              </div>
              <p style={{ fontSize: "12px", color: "var(--color-text-secondary)", margin: "0 0 16px 0", lineHeight: 1.5 }}>
                Upload store policies as text files (TXT, Markdown, CSV, JSON). They&apos;re split into chunks and indexed for your assistants to search. PDF and Word files aren&apos;t supported yet: save them as text first.
              </p>

              {/* Hidden File Input */}
              <input
                type="file"
                ref={fileInputRef}
                accept=".txt,.md,.csv,.json"
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileSelect(e.target.files[0]);
                  }
                }}
              />

              {/* Category Selector */}
              <div style={{ marginBottom: "16px" }}>
                <label
                  className={styles.formLabel}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}
                >
                  <span>Document Category • What kind of document are you uploading?</span>
                  <span style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "none" }}>
                    Directs AI reasoning & policy matching
                  </span>
                </label>
                <CategoryDropdown
                  selectedId={inferredType}
                  onSelect={(catId) => setInferredType(catId)}
                />
              </div>

              {/* Dropzone (shown when no file is selected) */}
              {!selectedFile ? (
                <div>
                  <div
                    className={`${styles.dropzone} ${isDragOver ? styles.dropzoneActive : ""}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <div className={styles.uploadIconCircle}>
                      <FileUp size={24} />
                    </div>
                    <h4 className={styles.dropzoneTitle}>Choose a document or drag & drop here</h4>
                    <p className={styles.dropzoneSubtext}>
                      Upload return policies, delivery rate charts, product FAQs, or sizing guides in Bangla or English
                    </p>
                    <div className={styles.formatsPill}>
                      Supported: TXT • MD • CSV • JSON (up to 2 MB of text)
                    </div>
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      style={{ marginTop: "8px", pointerEvents: "none" }}
                    >
                      Select File From Computer
                    </button>
                  </div>
                </div>
              ) : (
                /* Selected File Card & Processing Pipeline */
                <div>
                  <div className={styles.selectedFileCard}>
                    <div className={styles.fileHeaderRow}>
                      <div className={styles.fileMeta}>
                        <div className={styles.fileIconBox}>
                          <FileText size={20} />
                        </div>
                        <div>
                          <div className={styles.fileName}>{selectedFile.name}</div>
                          <div className={styles.fileDetails}>
                            {(selectedFile.size / 1024).toFixed(1)} KB • {fileContent.length.toLocaleString()} characters extracted
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleResetFile}
                        className={styles.docActionBtn}
                        title="Remove file"
                        style={{ color: "var(--color-text-secondary)" }}
                      >
                        <X size={18} />
                      </button>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", alignItems: "start" }}>
                      <div>
                        <label className={styles.formLabel}>Document Title (Auto-inferred)</label>
                        <input
                          type="text"
                          value={inferredTitle}
                          onChange={(e) => setInferredTitle(e.target.value)}
                          className={styles.textInput}
                          placeholder="Document title"
                        />
                      </div>
                      <div>
                        <label className={styles.formLabel}>Document Category</label>
                        <CategoryDropdown
                          selectedId={inferredType}
                          onSelect={(catId) => setInferredType(catId)}
                        />
                      </div>
                    </div>

                    {pipelineStep === "IDLE" && (
                      <button
                        type="button"
                        className={styles.btnPrimary}
                        onClick={handleProcessAndIngest}
                        style={{ width: "100%", marginTop: "4px" }}
                      >
                        <Zap size={16} />
                        Chunk, Embed & Send to Vector DB
                      </button>
                    )}

                    {pipelineStep !== "IDLE" && pipelineStep !== "DONE" && (
                      <button
                        type="button"
                        className={styles.btnPrimary}
                        disabled
                        style={{ width: "100%", marginTop: "4px", opacity: 0.8 }}
                      >
                        <RefreshCw size={16} className={styles.spin} />
                        Processing Ingestion Pipeline...
                      </button>
                    )}

                    {pipelineStep === "DONE" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        <div
                          style={{
                            padding: "12px 14px",
                            background: "rgba(46, 125, 50, 0.12)",
                            border: "1px solid #2E7D32",
                            borderRadius: "8px",
                            color: "#2E7D32",
                            fontSize: "13px",
                            fontWeight: 600,
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          <CheckCircle2 size={16} color="#2E7D32" />
                          <span>
                            Document indexed! Generated {pipelineStats?.chunkCount || 1} vector chunks into pgvector database.
                          </span>
                        </div>
                        <button
                          type="button"
                          className={styles.btnSecondary}
                          onClick={handleResetFile}
                          style={{ width: "100%" }}
                        >
                          Upload Another Document
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 4-Stage Visual Ingestion Stepper */}
                  {pipelineStep !== "IDLE" && (
                    <div className={styles.pipelineBox}>
                      <div className={styles.pipelineHeader}>
                        <div className={styles.pipelineTitle}>
                          <Database size={15} />
                          Vector Database Ingestion Pipeline
                        </div>
                        <span style={{ fontSize: "11px", color: pipelineStep === "DONE" ? "#81C784" : "#C7F900", fontWeight: 600 }}>
                          {pipelineStep === "DONE" ? "✓ Successfully Indexed" : "Processing..."}
                        </span>
                      </div>

                      <div className={styles.pipelineSteps}>
                        {/* Step 1: Text Extraction */}
                        <div
                          className={`${styles.pipelineStepItem} ${
                            pipelineStep === "EXTRACTING"
                              ? styles.pipelineStepItemActive
                              : styles.pipelineStepItemDone
                          }`}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700 }}>
                            {pipelineStep === "EXTRACTING" ? (
                              <RefreshCw size={12} className={styles.spin} />
                            ) : (
                              <Check size={12} />
                            )}
                            1. Extract
                          </div>
                          <span>File content parsed</span>
                        </div>

                        {/* Step 2: Semantic Chunking */}
                        <div
                          className={`${styles.pipelineStepItem} ${
                            pipelineStep === "CHUNKING"
                              ? styles.pipelineStepItemActive
                              : ["EMBEDDING", "STORING", "DONE"].includes(pipelineStep)
                              ? styles.pipelineStepItemDone
                              : ""
                          }`}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700 }}>
                            {pipelineStep === "CHUNKING" ? (
                              <RefreshCw size={12} className={styles.spin} />
                            ) : ["EMBEDDING", "STORING", "DONE"].includes(pipelineStep) ? (
                              <Check size={12} />
                            ) : (
                              <Clock size={12} />
                            )}
                            2. Chunk
                          </div>
                          <span>500-token windows</span>
                        </div>

                        {/* Step 3: Embeddings */}
                        <div
                          className={`${styles.pipelineStepItem} ${
                            pipelineStep === "EMBEDDING"
                              ? styles.pipelineStepItemActive
                              : ["STORING", "DONE"].includes(pipelineStep)
                              ? styles.pipelineStepItemDone
                              : ""
                          }`}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700 }}>
                            {pipelineStep === "EMBEDDING" ? (
                              <RefreshCw size={12} className={styles.spin} />
                            ) : ["STORING", "DONE"].includes(pipelineStep) ? (
                              <Check size={12} />
                            ) : (
                              <Clock size={12} />
                            )}
                            3. Embed
                          </div>
                          <span>1536-dim vectors</span>
                        </div>

                        {/* Step 4: Vector DB Storage */}
                        <div
                          className={`${styles.pipelineStepItem} ${
                            pipelineStep === "STORING"
                              ? styles.pipelineStepItemActive
                              : pipelineStep === "DONE"
                              ? styles.pipelineStepItemDone
                              : ""
                          }`}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700 }}>
                            {pipelineStep === "STORING" ? (
                              <RefreshCw size={12} className={styles.spin} />
                            ) : pipelineStep === "DONE" ? (
                              <Check size={12} />
                            ) : (
                              <Clock size={12} />
                            )}
                            4. Store
                          </div>
                          <span>pgvector indexed</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Ingested Document List */}
            <div className={styles.formCard}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                <h4 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                  Vector Database Indexed Guides ({knowledgeDocs.length})
                </h4>
                <button
                  type="button"
                  onClick={() => fetchData()}
                  className={styles.docActionBtn}
                  title="Refresh documents"
                >
                  <RefreshCw size={13} /> Refresh
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {knowledgeDocs.length === 0 ? (
                  <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", textAlign: "center", padding: "24px 0" }}>
                    No documents uploaded to vector database yet. Use the upload box above to index your first store policy.
                  </div>
                ) : (
                  knowledgeDocs.map((doc) => (
                    <div
                      key={doc.id}
                      style={{
                        padding: "12px 14px",
                        borderRadius: "10px",
                        background: "var(--color-surface-soft, rgba(255,255,255,0.04))",
                        border: "1px solid var(--color-border-subtle, rgba(255,255,255,0.08))",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "12px",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--color-text-primary, #ffffff)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {doc.title}
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--color-text-secondary, #9ca3af)", marginTop: "2px" }}>
                          {doc.document_type} • <strong style={{ color: "var(--color-text-primary, #ffffff)" }}>{doc.chunk_count}</strong> vector chunks • v{doc.version || 1}
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <Badge variant="success">Indexed</Badge>
                        <button
                          type="button"
                          className={styles.docActionBtn}
                          disabled={isReindexingDocId === doc.id}
                          onClick={() => handleReindexDocument(doc.id)}
                          title="Re-chunk and re-embed document"
                        >
                          <RefreshCw size={13} className={isReindexingDocId === doc.id ? styles.spin : ""} />
                        </button>
                        <button
                          type="button"
                          className={`${styles.docActionBtn} ${styles.docActionBtnDanger}`}
                          disabled={isDeletingDocId === doc.id}
                          onClick={() => handleDeleteDocument(doc.id)}
                          title="Delete from vector database"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Semantic Search Tester Column */}
          <div className={styles.formCard}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <Search size={18} color="#00897B" />
              <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                Knowledge Search Tester
              </h3>
            </div>
            <p style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "16px" }}>
              Type any question in Bangla, Banglish, or English to verify which store policy paragraphs the AI will cite to answer customers.
            </p>

            <div style={{ display: "flex", gap: "8px", marginBottom: "18px" }}>
              <input
                type="text"
                placeholder="e.g. ফেরত দেওয়ার নিয়ম কী? or how to return shirt?"
                value={ragQuery}
                onChange={(e) => setRagQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearchRag()}
                className={styles.textInput}
                style={{ flex: 1 }}
              />
              <button type="button" className={styles.btnPrimary} onClick={handleSearchRag} disabled={isSearchingRag}>
                {isSearchingRag ? "Searching..." : "Search"}
              </button>
            </div>

            <div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-muted, #9ca3af)", marginBottom: "10px", textTransform: "uppercase" }}>
                Matching Policy Citations ({ragResults.length})
              </div>
              {ragResults.length === 0 ? (
                <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--color-text-secondary, #9ca3af)", fontSize: "13px", background: "var(--color-surface-soft, rgba(255,255,255,0.03))", borderRadius: "10px" }}>
                  Ask a question above to test semantic retrieval across your policies.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {ragResults.map((r, i) => (
                    <div key={i} style={{ padding: "14px", borderRadius: "10px", background: "var(--color-surface-soft, rgba(255,255,255,0.03))", border: "1px solid var(--color-border-subtle, rgba(255,255,255,0.08))" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                        <span style={{ fontWeight: 700, fontSize: "13px", color: "var(--color-text-primary, #ffffff)" }}>{r.document_title}</span>
                        <Badge variant="default">Match: {(r.similarity_score * 100).toFixed(1)}%</Badge>
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--color-text-secondary, #9ca3af)", marginBottom: "6px" }}>Section: {r.section}</div>
                      <div style={{ fontSize: "12px", color: "#111827", background: "#FFFFFF", padding: "10px", borderRadius: "8px", border: "1px solid rgba(0,0,0,0.1)", whiteSpace: "pre-wrap" }}>
                        {r.content_snippet}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
