"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
  Clock,
  Search,
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
import styles from "./knowledge.module.css";

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

/** One hit from POST /api/v1/ai/knowledge/search. */
interface KnowledgeSearchHit {
  document_title: string;
  section: string;
  similarity_score: number;
  content_snippet: string;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Unknown error");

/** Store Knowledge Base (RAG): policy documents the assistants search. Moved here from the removed Automations hub. */
export default function KnowledgeBasePage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDoc[]>([]);
  const [ragQuery, setRagQuery] = useState("");
  const [ragResults, setRagResults] = useState<KnowledgeSearchHit[]>([]);
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
      setLoadError(null);
      const res = await fetch("/api/v1/ai/knowledge");
      if (res.status === 401) throw new Error("Please sign in to see the knowledge base.");
      if (res.status === 403) throw new Error("Your role can't view the store knowledge base.");
      if (!res.ok) throw new Error("Couldn't load the knowledge base.");
      const json = await res.json();
      if (json.data) setKnowledgeDocs(json.data);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

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
    } catch (err) {
      setPipelineStep("IDLE");
      setPipelineStats({ error: errorMessage(err) });
      alert("Pipeline Error: " + errorMessage(err));
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
    } catch (err) {
      alert("Delete failed: " + errorMessage(err));
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
    } catch (err) {
      alert("Re-index failed: " + errorMessage(err));
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

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h1>
            <Database size={32} />
            Store Knowledge Base
          </h1>
          <p className={styles.headerSubtitle}>
            Store policies and guides your assistants search to answer customers.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={fetchData} disabled={loading}>
            <RefreshCw size={15} className={loading ? styles.spin : ""} />
            Refresh
          </button>
        </div>
      </div>

      {loadError && (
        <div className={styles.card} style={{ marginBottom: "20px", color: "var(--color-danger)" }}>
          {loadError}
        </div>
      )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          {/* Ingestion & Documents Column */}
          <div>
            <div className={styles.formCard} style={{ marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <UploadCloud size={20} color="var(--color-text-primary)" />
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
                            background: "var(--color-success-bg)",
                            border: "1px solid var(--color-success)",
                            borderRadius: "8px",
                            color: "var(--color-success)",
                            fontSize: "13px",
                            fontWeight: 600,
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          <CheckCircle2 size={16} color="var(--color-success)" />
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
                        <span style={{ fontSize: "11px", color: pipelineStep === "DONE" ? "var(--color-success)" : "var(--color-lime-primary)", fontWeight: 600 }}>
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
                        background: "var(--color-surface-soft)",
                        border: "1px solid var(--color-border-subtle)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "12px",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {doc.title}
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginTop: "2px" }}>
                          {doc.document_type} • <strong style={{ color: "var(--color-text-primary)" }}>{doc.chunk_count}</strong> vector chunks • v{doc.version || 1}
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
              <Search size={18} color="var(--color-info)" />
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
              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-muted)", marginBottom: "10px", textTransform: "uppercase" }}>
                Matching Policy Citations ({ragResults.length})
              </div>
              {ragResults.length === 0 ? (
                <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--color-text-secondary)", fontSize: "13px", background: "var(--color-surface-soft)", borderRadius: "10px" }}>
                  Ask a question above to test semantic retrieval across your policies.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {ragResults.map((r, i) => (
                    <div key={i} style={{ padding: "14px", borderRadius: "10px", background: "var(--color-surface-soft)", border: "1px solid var(--color-border-subtle)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                        <span style={{ fontWeight: 700, fontSize: "13px", color: "var(--color-text-primary)" }}>{r.document_title}</span>
                        <Badge variant="default">Match: {(r.similarity_score * 100).toFixed(1)}%</Badge>
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "6px" }}>Section: {r.section}</div>
                      <div style={{ fontSize: "12px", color: "var(--color-text-primary)", background: "var(--color-surface-pure)", padding: "10px", borderRadius: "8px", border: "1px solid rgba(0,0,0,0.1)", whiteSpace: "pre-wrap" }}>
                        {r.content_snippet}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
    </div>
  );
}
