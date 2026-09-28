"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  PlugZap,
  Sparkles,
  Share2,
  Truck,
  Database,
  Search,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  Copy,
  Eye,
  EyeOff,
  Cpu,
  RefreshCw,
  X,
  BookOpen,
  ArrowRight,
  ShieldCheck,
  Server,
  Zap,
  Layers,
  Flame,
  Building2,
  Send,
} from "lucide-react";
import {
  ConnectorCategory,
  ConnectorProviderDefinition,
  ConnectorConfigRecord,
  TestConnectionResult,
} from "@/types/connector";
import { LoadingSkeleton, ErrorState, EmptyState } from "@/components/ui/States/States";
import { Modal } from "@/components/ui/Modal/Modal";
import styles from "./connector.module.css";

export default function ConnectorPage() {
  const [providers, setProviders] = useState<ConnectorProviderDefinition[]>([]);
  const [configurations, setConfigurations] = useState<Array<Omit<ConnectorConfigRecord, "credentials_encrypted">>>([]);
  const [stats, setStats] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // View Scope: STORE (Delivery, Social, Google Ads) vs INFRA (LLMs, Vector DB, Redis, DBs, ERP) vs ALL
  const [viewScope, setViewScope] = useState<"STORE" | "INFRA" | "ALL">("STORE");
  // Active filter & search
  const [activeCategory, setActiveCategory] = useState<ConnectorCategory | "ALL" | "GOOGLE_ADS">("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const isAdmin =
    session?.role === "ADMIN" ||
    session?.role === "OWNER" ||
    session?.role === "DEV";

  // Modal Configuration State
  const [selectedProvider, setSelectedProvider] = useState<ConnectorProviderDefinition | null>(null);
  const [modalFormData, setModalFormData] = useState<Record<string, any>>({});
  const [modalEndpoint, setModalEndpoint] = useState("");
  const [modalDefaultModel, setModalDefaultModel] = useState("");
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // Guidance Drawer State
  const [drawerProvider, setDrawerProvider] = useState<ConnectorProviderDefinition | null>(null);

  // Copy feedback state
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const loadConnectors = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [res, sessRes] = await Promise.all([
        fetch("/api/v1/connectors"),
        fetch("/api/v1/auth/session"),
      ]);

      if (sessRes.ok) {
        const sJson = await sessRes.json();
        setSession(sJson.data);
      }

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to load connectors.");
      }
      const json = await res.json();
      setProviders(json.data.providers || []);
      setConfigurations(json.data.configurations || []);
      setStats(json.data.stats || null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Error fetching connector catalog.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadConnectors();
  }, []);

  // Parse URL query params (e.g. from Enterprise Integrations Hub links)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const cat = params.get("category");
      const prov = params.get("provider");
      if (
        cat &&
        [
          "ALL",
          "AI_LLM",
          "VECTOR_DB",
          "REDIS_CACHE",
          "SOCIAL_ADS",
          "LOGISTICS",
          "DATABASE",
          "ENTERPRISE",
        ].includes(cat)
      ) {
        setActiveCategory(cat as any);
      }
      if (prov && providers.length > 0) {
        const found = providers.find((p) => p.id === prov);
        if (found) {
          handleOpenConfigure(found);
        }
      }
    }
  }, [providers]);

  // Filtered providers
  const filteredProviders = useMemo(() => {
    return providers.filter((p) => {
      // For regular store users (or STORE view scope): Only Parcel Delivery, Social Media, and Google Ads connect
      if (!isAdmin || viewScope === "STORE") {
        if (p.category !== "LOGISTICS" && p.category !== "SOCIAL_ADS") {
          return false;
        }
      } else if (viewScope === "INFRA") {
        if (p.category === "LOGISTICS" || p.category === "SOCIAL_ADS") {
          return false;
        }
      }

      let matchCategory = true;
      if (activeCategory === "GOOGLE_ADS") {
        matchCategory = p.id === "google_ads";
      } else if (activeCategory !== "ALL") {
        matchCategory = p.category === activeCategory;
      }

      const matchQuery =
        searchQuery.trim() === "" ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.suggested_models && p.suggested_models.some((m) => m.toLowerCase().includes(searchQuery.toLowerCase())));
      return matchCategory && matchQuery;
    });
  }, [providers, activeCategory, searchQuery, isAdmin, viewScope]);

  // Map of active configs by provider ID
  const configMap = useMemo(() => {
    const map = new Map<string, Omit<ConnectorConfigRecord, "credentials_encrypted">>();
    for (const c of configurations) {
      map.set(c.provider_id, c);
    }
    return map;
  }, [configurations]);

  // Open Configure Modal
  const handleOpenConfigure = (provider: ConnectorProviderDefinition) => {
    setSelectedProvider(provider);
    setTestResult(null);
    setTestError(null);

    const existing = configMap.get(provider.id);
    const initialForm: Record<string, any> = {};

    for (const field of provider.fields) {
      if (existing?.credentials_masked && existing.credentials_masked[field.name]) {
        initialForm[field.name] = existing.credentials_masked[field.name];
      } else if (field.defaultValue !== undefined) {
        initialForm[field.name] = field.defaultValue;
      } else {
        initialForm[field.name] = "";
      }
    }

    setModalFormData(initialForm);
    setModalEndpoint(existing?.endpoint_url || provider.default_endpoint || "");
    setModalDefaultModel(existing?.default_model || provider.suggested_models?.[0] || "");
  };

  // Handle Smart Database URI Parsing
  const handleUriChange = (rawUri: string) => {
    setModalFormData((prev) => ({ ...prev, connection_uri: rawUri }));
    if (!rawUri.trim()) return;

    try {
      const url = new URL(rawUri);
      const protocol = url.protocol.replace(":", "").toLowerCase();
      let port = url.port ? parseInt(url.port, 10) : 5432;
      if (protocol.includes("mysql")) port = 3306;
      if (protocol.includes("redis")) port = 6379;

      const host = url.hostname;
      const database = url.pathname ? url.pathname.replace(/^\//, "") : "";
      const username = decodeURIComponent(url.username || "");
      const password = decodeURIComponent(url.password || "");

      const sslParam = url.searchParams.get("sslmode") || url.searchParams.get("ssl");
      let ssl_mode = "require";
      if (sslParam === "disable" || sslParam === "false") ssl_mode = "disable";

      setModalFormData((prev) => ({
        ...prev,
        connection_uri: rawUri,
        host: host || prev.host,
        port: port || prev.port,
        database: database || prev.database,
        username: username || prev.username,
        password: password || prev.password,
        ssl_mode: ssl_mode || prev.ssl_mode,
      }));
    } catch {
      // Ignore invalid URL while typing
    }
  };

  // Test Connection
  const handleTestConnection = async () => {
    if (!selectedProvider) return;
    setIsTesting(true);
    setTestResult(null);
    setTestError(null);

    try {
      const res = await fetch("/api/v1/connectors/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider_id: selectedProvider.id,
          endpoint_url: modalEndpoint,
          default_model: modalDefaultModel,
          credentials: modalFormData,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || "Connection test failed.");
      }

      setTestResult(json.data);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "Connection failed.");
    } finally {
      setIsTesting(false);
    }
  };

  // Save Connector Configuration
  const handleSaveConnector = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProvider) return;
    setIsSaving(true);
    setTestError(null);

    try {
      const res = await fetch("/api/v1/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider_id: selectedProvider.id,
          name: selectedProvider.name,
          endpoint_url: modalEndpoint,
          default_model: modalDefaultModel,
          credentials: modalFormData,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || "Failed to save connector.");
      }

      setSelectedProvider(null);
      await loadConnectors();
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "Error saving connector.");
    } finally {
      setIsSaving(false);
    }
  };

  // Disconnect / Delete Connector
  const handleDisconnectConnector = async (connectorId: string) => {
    if (!confirm("Are you sure you want to disconnect this server/service?")) return;
    try {
      const res = await fetch(`/api/v1/connectors/${connectorId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to disconnect.");
      setSelectedProvider(null);
      await loadConnectors();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to disconnect.");
    }
  };

  // Copy to clipboard helper
  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  // Render provider category icon
  const renderCategoryIcon = (category: ConnectorCategory) => {
    switch (category) {
      case "AI_LLM":
        return <Sparkles size={20} style={{ color: "#7B61FF" }} />;
      case "VECTOR_DB":
        return <Layers size={20} style={{ color: "#9C27B0" }} />;
      case "REDIS_CACHE":
        return <Flame size={20} style={{ color: "#E53935" }} />;
      case "SOCIAL_ADS":
        return <Share2 size={20} style={{ color: "#0084FF" }} />;
      case "LOGISTICS":
        return <Truck size={20} style={{ color: "#E65100" }} />;
      case "DATABASE":
        return <Database size={20} style={{ color: "#00897B" }} />;
      case "ENTERPRISE":
        return <Building2 size={20} style={{ color: "#F3B63F" }} />;
    }
  };

  const renderProviderIcon = (provider: ConnectorProviderDefinition) => {
    if (provider.id === "telegram") {
      return <Send size={20} style={{ color: "#229ED9" }} />;
    }
    return renderCategoryIcon(provider.category);
  };

  if (isLoading && providers.length === 0) {
    return (
      <div className={styles.container}>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <LoadingSkeleton lines={2} height="60px" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
            <LoadingSkeleton lines={4} height="200px" />
            <LoadingSkeleton lines={4} height="200px" />
            <LoadingSkeleton lines={4} height="200px" />
          </div>
        </div>
      </div>
    );
  }

  if (errorMessage && providers.length === 0) {
    return (
      <div className={styles.container}>
        <ErrorState
          title="Failed to Load Connectors Hub"
          message={errorMessage}
          onRetry={loadConnectors}
        />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Header Section */}
      <div className={styles.headerSection}>
        <div className={styles.titleArea}>
          <div className={styles.titleRow}>
            <PlugZap size={28} style={{ color: "var(--color-lime-primary, #C7F900)" }} />
            <h1 className={styles.pageTitle}>
              {!isAdmin || viewScope === "STORE"
                ? "Store Connectors & Logistics Hub"
                : viewScope === "INFRA"
                ? "Cloud Infrastructure & AI Gateway Hub"
                : "Connectors & Integrations Gateway"}
            </h1>
          </div>
          <p className={styles.pageSubtitle}>
            {!isAdmin || viewScope === "STORE"
              ? "Connect Bangladeshi parcel delivery couriers (Steadfast, Pathao, RedX, Paperfly, eCourier, DHL), omnichannel social messaging (Meta Facebook & Instagram, WhatsApp, TikTok, Telegram), and Google Ads conversion attribution."
              : "Unified multi-server gateway. Connect frontier LLM models (OpenAI, Claude, Gemini, Ollama), vector databases (Qdrant, Pinecone), Redis caching, and enterprise ERPs with AES-256-GCM encryption."}
          </p>
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            onClick={loadConnectors}
            className={styles.guideButton}
            title="Refresh connectors"
          >
            <RefreshCw size={14} /> Refresh Catalog
          </button>
        </div>
      </div>

      {/* Admin Scope Switcher */}
      {isAdmin && (
        <div className={styles.scopeBar} role="group" aria-label="Connector view mode">
          <button
            type="button"
            className={`${styles.scopeButton} ${viewScope === "STORE" ? styles.scopeButtonActive : ""}`}
            onClick={() => {
              setViewScope("STORE");
              setActiveCategory("ALL");
            }}
          >
            📦 Store Channels (Couriers, Social, Ads)
          </button>
          <button
            type="button"
            className={`${styles.scopeButton} ${viewScope === "INFRA" ? styles.scopeButtonActive : ""}`}
            onClick={() => {
              setViewScope("INFRA");
              setActiveCategory("ALL");
            }}
          >
            ⚡ Cloud & Infrastructure (LLMs, Vector DB, Redis, DBs, ERP)
          </button>
          <button
            type="button"
            className={`${styles.scopeButton} ${viewScope === "ALL" ? styles.scopeButtonActive : ""}`}
            onClick={() => {
              setViewScope("ALL");
              setActiveCategory("ALL");
            }}
          >
            🌐 All Connectors
          </button>
        </div>
      )}

      {/* Metrics Overview Strip */}
      <div className={styles.metricsStrip}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>
            <Zap size={13} style={{ color: "#4CAF70" }} /> Active Connections
          </span>
          <div className={styles.metricValueRow}>
            <span className={styles.metricValue}>
              {!isAdmin || viewScope === "STORE"
                ? configurations.filter((c) => c.category === "LOGISTICS" || c.category === "SOCIAL_ADS").length
                : stats?.total_active ?? configurations.length}
            </span>
            <span className={styles.metricSubtext}>
              of {filteredProviders.length} in this view
            </span>
          </div>
        </div>

        {(!isAdmin || viewScope === "STORE") ? (
          <>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>
                <Truck size={13} style={{ color: "#E65100" }} /> Parcel Delivery
              </span>
              <div className={styles.metricValueRow}>
                <span className={styles.metricValue}>
                  {configurations.find((c) => c.category === "LOGISTICS")?.name || "Pending setup"}
                </span>
                <span className={styles.metricSubtext}>
                  {configurations.filter((c) => c.category === "LOGISTICS").length} connected
                </span>
              </div>
            </div>

            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>
                <Share2 size={13} style={{ color: "#00897B" }} /> Social Channels
              </span>
              <div className={styles.metricValueRow}>
                <span className={styles.metricValue}>
                  {configurations.filter((c) => c.category === "SOCIAL_ADS" && c.provider_id !== "google_ads").length} active
                </span>
                <span className={styles.metricSubtext}>Meta, WhatsApp, TikTok, TG</span>
              </div>
            </div>

            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>
                <Sparkles size={13} style={{ color: "#4285F4" }} /> Google Ads Connect
              </span>
              <div className={styles.metricValueRow}>
                <span className={styles.metricValue}>
                  {configurations.find((c) => c.provider_id === "google_ads") ? "Active" : "Not Linked"}
                </span>
                <span className={styles.metricSubtext}>Offline conversion sync</span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>
                <Sparkles size={13} style={{ color: "#7B61FF" }} /> ✦ AI & LLM Servers
              </span>
              <div className={styles.metricValueRow}>
                <span className={styles.metricValue}>
                  {configurations.find((c) => c.category === "AI_LLM")?.default_model || "None active"}
                </span>
                <span className={styles.metricSubtext}>
                  {stats?.by_category?.AI_LLM?.active ?? 0} connected
                </span>
              </div>
            </div>

            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>
                <Database size={13} style={{ color: "#00897B" }} /> Primary Database
              </span>
              <div className={styles.metricValueRow}>
                <span className={styles.metricValue}>
                  {configurations.find((c) => c.category === "DATABASE")?.name || "Built-in Store"}
                </span>
                <span className={styles.metricSubtext}>
                  {stats?.by_category?.DATABASE?.active ?? 0} active
                </span>
              </div>
            </div>

            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>
                <Building2 size={13} style={{ color: "#F3B63F" }} /> Enterprise & ERP
              </span>
              <div className={styles.metricValueRow}>
                <span className={styles.metricValue}>
                  {configurations.find((c) => c.category === "ENTERPRISE")?.name || "Ready to connect"}
                </span>
                <span className={styles.metricSubtext}>
                  {stats?.by_category?.ENTERPRISE?.active ?? 0} active
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Controls Bar: Tabs & Search */}
      <div className={styles.controlsBar}>
        <div className={styles.tabsList} role="tablist">
          {(!isAdmin || viewScope === "STORE") ? (
            <>
              <button
                type="button"
                className={`${styles.tabButton} ${activeCategory === "ALL" ? styles.activeTab : ""}`}
                onClick={() => setActiveCategory("ALL")}
              >
                All Store Channels
                <span className={styles.tabBadge}>
                  {providers.filter((p) => p.category === "LOGISTICS" || p.category === "SOCIAL_ADS").length}
                </span>
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${activeCategory === "LOGISTICS" ? styles.activeTab : ""}`}
                onClick={() => setActiveCategory("LOGISTICS")}
              >
                Parcel Delivery (Couriers)
                <span className={styles.tabBadge}>
                  {providers.filter((p) => p.category === "LOGISTICS").length}
                </span>
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${activeCategory === "SOCIAL_ADS" ? styles.activeTab : ""}`}
                onClick={() => setActiveCategory("SOCIAL_ADS")}
              >
                Social Channels & Chats
                <span className={styles.tabBadge}>
                  {providers.filter((p) => p.category === "SOCIAL_ADS" && p.id !== "google_ads").length}
                </span>
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${activeCategory === "GOOGLE_ADS" ? styles.activeTab : ""}`}
                onClick={() => setActiveCategory("GOOGLE_ADS")}
              >
                Google Ads Connect
                <span className={styles.tabBadge}>1</span>
              </button>
            </>
          ) : viewScope === "INFRA" ? (
            <>
              <button
                type="button"
                className={`${styles.tabButton} ${activeCategory === "ALL" ? styles.activeTab : ""}`}
                onClick={() => setActiveCategory("ALL")}
              >
                All Infrastructure
                <span className={styles.tabBadge}>
                  {providers.filter((p) => p.category !== "LOGISTICS" && p.category !== "SOCIAL_ADS").length}
                </span>
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${activeCategory === "AI_LLM" ? styles.activeTab : ""}`}
                onClick={() => setActiveCategory("AI_LLM")}
              >
                ✦ AI & LLM Models
                <span className={styles.tabBadge}>
                  {providers.filter((p) => p.category === "AI_LLM").length}
                </span>
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${activeCategory === "VECTOR_DB" ? styles.activeTab : ""}`}
                onClick={() => setActiveCategory("VECTOR_DB")}
              >
                Vector Databases (RAG)
                <span className={styles.tabBadge}>
                  {providers.filter((p) => p.category === "VECTOR_DB").length}
                </span>
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${activeCategory === "REDIS_CACHE" ? styles.activeTab : ""}`}
                onClick={() => setActiveCategory("REDIS_CACHE")}
              >
                Redis & In-Memory Cache
                <span className={styles.tabBadge}>
                  {providers.filter((p) => p.category === "REDIS_CACHE").length}
                </span>
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${activeCategory === "ENTERPRISE" ? styles.activeTab : ""}`}
                onClick={() => setActiveCategory("ENTERPRISE")}
              >
                Enterprise & ERP Systems
                <span className={styles.tabBadge}>
                  {providers.filter((p) => p.category === "ENTERPRISE").length}
                </span>
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${activeCategory === "DATABASE" ? styles.activeTab : ""}`}
                onClick={() => setActiveCategory("DATABASE")}
              >
                Relational Databases
                <span className={styles.tabBadge}>
                  {providers.filter((p) => p.category === "DATABASE").length}
                </span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`${styles.tabButton} ${activeCategory === "ALL" ? styles.activeTab : ""}`}
                onClick={() => setActiveCategory("ALL")}
              >
                All Connectors
                <span className={styles.tabBadge}>{providers.length}</span>
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${activeCategory === "LOGISTICS" ? styles.activeTab : ""}`}
                onClick={() => setActiveCategory("LOGISTICS")}
              >
                Parcel Delivery
                <span className={styles.tabBadge}>
                  {providers.filter((p) => p.category === "LOGISTICS").length}
                </span>
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${activeCategory === "SOCIAL_ADS" ? styles.activeTab : ""}`}
                onClick={() => setActiveCategory("SOCIAL_ADS")}
              >
                Social Media & Ads
                <span className={styles.tabBadge}>
                  {providers.filter((p) => p.category === "SOCIAL_ADS").length}
                </span>
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${activeCategory === "AI_LLM" ? styles.activeTab : ""}`}
                onClick={() => setActiveCategory("AI_LLM")}
              >
                ✦ AI Models
                <span className={styles.tabBadge}>
                  {providers.filter((p) => p.category === "AI_LLM").length}
                </span>
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${activeCategory === "VECTOR_DB" ? styles.activeTab : ""}`}
                onClick={() => setActiveCategory("VECTOR_DB")}
              >
                Vector DB
                <span className={styles.tabBadge}>
                  {providers.filter((p) => p.category === "VECTOR_DB").length}
                </span>
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${activeCategory === "REDIS_CACHE" ? styles.activeTab : ""}`}
                onClick={() => setActiveCategory("REDIS_CACHE")}
              >
                Redis
                <span className={styles.tabBadge}>
                  {providers.filter((p) => p.category === "REDIS_CACHE").length}
                </span>
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${activeCategory === "DATABASE" ? styles.activeTab : ""}`}
                onClick={() => setActiveCategory("DATABASE")}
              >
                Databases
                <span className={styles.tabBadge}>
                  {providers.filter((p) => p.category === "DATABASE").length}
                </span>
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${activeCategory === "ENTERPRISE" ? styles.activeTab : ""}`}
                onClick={() => setActiveCategory("ENTERPRISE")}
              >
                Enterprise
                <span className={styles.tabBadge}>
                  {providers.filter((p) => p.category === "ENTERPRISE").length}
                </span>
              </button>
            </>
          )}
        </div>

        <div className={styles.searchBox}>
          <Search size={16} style={{ color: "var(--color-text-muted)" }} />
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search model, courier, or database..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              style={{ background: "transparent", border: "none", cursor: "pointer", padding: "2px" }}
            >
              <X size={14} style={{ color: "var(--color-text-muted)" }} />
            </button>
          )}
        </div>
      </div>

      {/* 12-Column Bento Grid of Connectors */}
      <div className={styles.bentoGrid}>
        {filteredProviders.length === 0 ? (
          <div className={styles.emptyState}>
            <EmptyState
              title="No Connectors Found"
              description={`No services matched your query "${searchQuery}". Try selecting another category tab or clearing the search.`}
              actionText="Clear Search"
              onAction={() => {
                setSearchQuery("");
                setActiveCategory("ALL");
              }}
            />
          </div>
        ) : (
          filteredProviders.map((provider) => {
            const config = configMap.get(provider.id);
            const isConnected = config?.status === "ACTIVE";

            return (
              <div
                key={provider.id}
                className={`${styles.connectorCard} ${isConnected ? styles.cardActiveBorder : ""}`}
              >
                {/* Header */}
                <div className={styles.cardHeader}>
                  <div className={styles.providerInfo}>
                    <div className={styles.providerIconBox}>
                      {renderProviderIcon(provider)}
                    </div>
                    <div className={styles.providerDetails}>
                      <div className={styles.providerNameRow}>
                        <h3 className={styles.providerName}>{provider.name}</h3>
                        {provider.badge && (
                          <span className={styles.providerBadge}>{provider.badge}</span>
                        )}
                      </div>
                      <span className={styles.categoryTag}>
                        {provider.category.replace("_", " ")}
                      </span>
                    </div>
                  </div>

                  {/* Status Pill */}
                  <span
                    className={`${styles.cardStatusPill} ${
                      isConnected ? styles.statusActive : styles.statusNotConfigured
                    }`}
                  >
                    <span className={styles.statusDot} />
                    {isConnected ? "Active" : "Not Configured"}
                  </span>
                </div>

                {/* Description */}
                <p className={styles.cardDescription}>{provider.description}</p>

                {/* Active Details Snippet if Connected */}
                {isConnected && config && (
                  <div className={styles.activeConfigSnippet}>
                    {config.default_model && (
                      <div className={styles.configSnippetRow}>
                        <span className={styles.configSnippetLabel}>Model / Version:</span>
                        <span className={styles.configSnippetValue}>{config.default_model}</span>
                      </div>
                    )}
                    {config.endpoint_url && (
                      <div className={styles.configSnippetRow}>
                        <span className={styles.configSnippetLabel}>Endpoint:</span>
                        <span className={styles.configSnippetValue}>{config.endpoint_url}</span>
                      </div>
                    )}
                    {typeof config.last_test_latency_ms === "number" && (
                      <div className={styles.configSnippetRow}>
                        <span className={styles.configSnippetLabel}>Latency:</span>
                        <span style={{ fontWeight: 600 }}>{config.last_test_latency_ms} ms</span>
                      </div>
                    )}
                    {config.health_status === "UNVERIFIED" && (
                      <div className={styles.configSnippetRow}>
                        <span className={styles.configSnippetLabel}>Status:</span>
                        <span style={{ fontWeight: 600 }}>Saved, not verified with the provider</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Card Actions Footer */}
                <div className={styles.cardFooter}>
                  <div className={styles.footerLeft}>
                    <button
                      type="button"
                      className={styles.guideButton}
                      onClick={() => setDrawerProvider(provider)}
                    >
                      <BookOpen size={13} /> Guide
                    </button>
                    {isConnected && (
                      <button
                        type="button"
                        className={styles.testPingButton}
                        onClick={() => handleOpenConfigure(provider)}
                        title="Run real-time handshake check"
                      >
                        <RefreshCw size={13} /> Ping
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    className={`${styles.connectButton} ${
                      isConnected ? styles.connectButtonActive : styles.connectButtonPrimary
                    }`}
                    onClick={() => handleOpenConfigure(provider)}
                  >
                    {isConnected ? "Configure" : "Connect"}
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Interactive Configuration Modal */}
      {selectedProvider && (
        <Modal
          isOpen={true}
          onClose={() => setSelectedProvider(null)}
          title={`Configure ${selectedProvider.name}`}
        >
          <form onSubmit={handleSaveConnector} className={styles.modalForm}>
            {/* Smart Database URI Parser for Database Category */}
            {selectedProvider.category === "DATABASE" && (
              <div className={styles.smartUriBox}>
                <div className={styles.smartUriHeader}>
                  <span>⚡ Smart Connection String Parser</span>
                  <span>Auto-detects host, port, DB & SSL</span>
                </div>
                <input
                  type="password"
                  className={styles.textInput}
                  placeholder="Paste postgresql://user:pass@host:port/dbname?sslmode=require"
                  value={modalFormData.connection_uri || ""}
                  onChange={(e) => handleUriChange(e.target.value)}
                />
                <span className={styles.smartUriHint}>
                  Paste your raw Supabase or Neon URI above to auto-populate the breakdown fields below.
                </span>
              </div>
            )}

            {/* Custom Endpoint URL */}
            {(selectedProvider.default_endpoint || selectedProvider.category === "AI_LLM") && (
              <div className={styles.formFieldGroup}>
                <div className={styles.fieldLabelRow}>
                  <label className={styles.fieldLabel}>API Endpoint / Base URL</label>
                  <span className={styles.fieldDescription}>Default: {selectedProvider.default_endpoint || "Standard"}</span>
                </div>
                <input
                  type="url"
                  className={styles.textInput}
                  placeholder={selectedProvider.default_endpoint || "https://..."}
                  value={modalEndpoint}
                  onChange={(e) => setModalEndpoint(e.target.value)}
                />
              </div>
            )}

            {/* Suggested Models Selection (for AI Category) */}
            {selectedProvider.category === "AI_LLM" && selectedProvider.suggested_models && (
              <div className={styles.modelSuggestionsArea}>
                <label className={styles.fieldLabel}>Suggested Latest Models</label>
                <div className={styles.suggestedChipsRow}>
                  {selectedProvider.suggested_models.map((m) => (
                    <button
                      type="button"
                      key={m}
                      className={`${styles.modelChip} ${modalDefaultModel === m ? styles.activeModelChip : ""}`}
                      onClick={() => setModalDefaultModel(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <div className={styles.inputWrapper}>
                  <input
                    type="text"
                    className={styles.textInput}
                    placeholder="Or type custom model name (e.g. meta-llama/Llama-3.3-70B)"
                    value={modalDefaultModel}
                    onChange={(e) => setModalDefaultModel(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Provider Dynamic Fields */}
            {selectedProvider.fields
              .filter((f) => f.name !== "connection_uri")
              .map((field) => {
                const isSecret = field.type === "password";
                const isVisible = showSecrets[field.name];

                return (
                  <div key={field.name} className={styles.formFieldGroup}>
                    <div className={styles.fieldLabelRow}>
                      <label className={styles.fieldLabel}>
                        {field.label}
                        {field.required && <span className={styles.requiredStar}>*</span>}
                      </label>
                      {field.description && (
                        <span className={styles.fieldDescription}>{field.description}</span>
                      )}
                    </div>

                    {field.type === "select" && field.options ? (
                      <select
                        className={styles.selectInput}
                        value={modalFormData[field.name] ?? field.defaultValue ?? ""}
                        onChange={(e) =>
                          setModalFormData((prev) => ({ ...prev, [field.name]: e.target.value }))
                        }
                      >
                        {field.options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : field.type === "boolean" ? (
                      <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
                        <input
                          type="checkbox"
                          checked={Boolean(modalFormData[field.name] ?? field.defaultValue)}
                          onChange={(e) =>
                            setModalFormData((prev) => ({ ...prev, [field.name]: e.target.checked }))
                          }
                        />
                        Enable {field.label}
                      </label>
                    ) : (
                      <div className={styles.inputWrapper}>
                        <input
                          type={isSecret && !isVisible ? "password" : field.type === "number" ? "number" : "text"}
                          className={styles.textInput}
                          placeholder={field.placeholder || ""}
                          value={modalFormData[field.name] ?? ""}
                          onChange={(e) =>
                            setModalFormData((prev) => ({
                              ...prev,
                              [field.name]: field.type === "number" ? Number(e.target.value) : e.target.value,
                            }))
                          }
                          required={field.required}
                        />
                        {isSecret && (
                          <button
                            type="button"
                            className={styles.passwordToggle}
                            onClick={() =>
                              setShowSecrets((prev) => ({ ...prev, [field.name]: !prev[field.name] }))
                            }
                          >
                            {isVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

            {/* Test Banner Feedback */}
            {testResult && (
              // Success styling only for a real, verified connection (FX-31)
              <div className={`${styles.testBanner} ${testResult.success ? styles.testBannerSuccess : styles.testBannerError}`}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {testResult.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                  <span>{testResult.message}</span>
                </div>
                {typeof testResult.latency_ms === "number" && <span style={{ fontWeight: 700 }}>{testResult.latency_ms} ms</span>}
              </div>
            )}

            {testError && (
              <div className={`${styles.testBanner} ${styles.testBannerError}`}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <AlertCircle size={16} />
                  <span>{testError}</span>
                </div>
              </div>
            )}

            {isTesting && (
              <div className={`${styles.testBanner} ${styles.testBannerTesting}`}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Verifying connection handshake with {selectedProvider.name}...</span>
                </div>
              </div>
            )}

            {/* Modal Footer */}
            <div className={styles.modalFooter}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  className={styles.guideButton}
                  onClick={handleTestConnection}
                  disabled={isTesting || isSaving}
                >
                  <RefreshCw size={13} /> Test Connection
                </button>

                {configMap.has(selectedProvider.id) && (
                  <button
                    type="button"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#C62828",
                      fontSize: "12px",
                      cursor: "pointer",
                      padding: "6px 8px",
                    }}
                    onClick={() => {
                      const id = configMap.get(selectedProvider.id)?.id;
                      if (id) handleDisconnectConnector(id);
                    }}
                  >
                    Disconnect
                  </button>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  className={styles.guideButton}
                  onClick={() => setSelectedProvider(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`${styles.connectButton} ${styles.connectButtonActive}`}
                  disabled={isSaving}
                >
                  {isSaving ? "Encrypting & Saving..." : "Save & Activate"}
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {/* Slide-Over Guidance Drawer */}
      {drawerProvider && (
        <div className={styles.drawerBackdrop} onClick={() => setDrawerProvider(null)}>
          <div className={styles.drawerPanel} onClick={(e) => e.stopPropagation()}>
            <div className={styles.drawerHeader}>
              <div className={styles.drawerTitleRow}>
                <BookOpen size={18} style={{ color: "var(--color-lime-primary, #C7F900)" }} />
                <h3 className={styles.drawerTitle}>How to Connect {drawerProvider.name}</h3>
              </div>
              <button
                type="button"
                className={styles.closeDrawerButton}
                onClick={() => setDrawerProvider(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className={styles.drawerBody}>
              {/* Direct Portal Banner */}
              <div className={styles.portalBanner}>
                <div className={styles.portalBannerLeft}>
                  <span className={styles.portalBannerTitle}>Official Developer Console</span>
                  <span className={styles.portalBannerSubtitle}>Generate API tokens and credentials</span>
                </div>
                <a
                  href={drawerProvider.guidelines.portal_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.portalLinkButton}
                >
                  Open Portal <ExternalLink size={13} />
                </a>
              </div>

              {/* Prerequisites */}
              <div className={styles.guidelineSection}>
                <h4 className={styles.guidelineSectionTitle}>Prerequisites</h4>
                <ul className={styles.prereqList}>
                  {drawerProvider.guidelines.prerequisites.map((prereq, idx) => (
                    <li key={idx}>{prereq}</li>
                  ))}
                </ul>
              </div>

              {/* Step-by-Step Instructions */}
              <div className={styles.guidelineSection}>
                <h4 className={styles.guidelineSectionTitle}>Step-by-Step Setup Walkthrough</h4>
                <ol className={styles.stepsList}>
                  {drawerProvider.guidelines.steps.map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ol>
              </div>

              {/* Webhook Callback Endpoint if applicable */}
              {drawerProvider.guidelines.webhook_info && (
                <div className={styles.guidelineSection}>
                  <h4 className={styles.guidelineSectionTitle}>Webhook Callback URL</h4>
                  <div className={styles.codeSnippetBox}>
                    <code>{typeof window !== "undefined" ? window.location.origin : ""}{drawerProvider.guidelines.webhook_info}</code>
                    <button
                      type="button"
                      className={styles.copyCodeButton}
                      onClick={() =>
                        handleCopy(
                          `${typeof window !== "undefined" ? window.location.origin : ""}${drawerProvider.guidelines.webhook_info}`,
                          "webhook"
                        )
                      }
                    >
                      {copiedKey === "webhook" ? "Copied!" : <Copy size={12} />}
                    </button>
                  </div>
                  <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                    Paste this into your {drawerProvider.name} developer portal webhook settings.
                  </span>
                </div>
              )}

              {/* Terminal commands for self-hosted */}
              {drawerProvider.guidelines.terminal_commands && (
                <div className={styles.guidelineSection}>
                  <h4 className={styles.guidelineSectionTitle}>Terminal Commands</h4>
                  {drawerProvider.guidelines.terminal_commands.map((cmd, idx) => (
                    <div key={idx} className={styles.codeSnippetBox}>
                      <code>{cmd}</code>
                      <button
                        type="button"
                        className={styles.copyCodeButton}
                        onClick={() => handleCopy(cmd, `cmd-${idx}`)}
                      >
                        {copiedKey === `cmd-${idx}` ? "Copied!" : <Copy size={12} />}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Best Practice Tips */}
              {drawerProvider.guidelines.tips && drawerProvider.guidelines.tips.length > 0 && (
                <div className={styles.tipsBox}>
                  <strong style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <ShieldCheck size={15} /> Security & Architecture Tips
                  </strong>
                  {drawerProvider.guidelines.tips.map((tip, idx) => (
                    <span key={idx}>• {tip}</span>
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
