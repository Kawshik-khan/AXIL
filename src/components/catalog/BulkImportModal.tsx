"use client";

import React, { useState, useRef } from "react";
import {
  UploadCloud,
  FileSpreadsheet,
  Download,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Layers,
  ArrowRight,
  FileText,
  Share2,
  Link2,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal/Modal";
import { Button } from "@/components/ui/Button/Button";
import { Badge } from "@/components/ui/Badge/Badge";
import { CsvParser } from "@/lib/csv-parser";
import { BulkImportResult, BulkImportRowError } from "@/types/catalog-import";

interface BulkImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type ImportStep = "upload" | "preview" | "importing" | "result";

export const BulkImportModal: React.FC<BulkImportModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<ImportStep>("upload");
  const [fileName, setFileName] = useState<string>("");
  const [csvContent, setCsvContent] = useState<string>("");
  const [previewHeaders, setPreviewHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [totalRowCount, setTotalRowCount] = useState<number>(0);
  const [mode, setMode] = useState<"upsert" | "create_only">("upsert");
  const [autoCreateCategories, setAutoCreateCategories] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  // Google Sheets state
  const [importSource, setImportSource] = useState<"csv" | "google_sheets">("csv");
  const [googleSheetUrl, setGoogleSheetUrl] = useState<string>("");
  const [googleSheetTabName, setGoogleSheetTabName] = useState<string>("Products");
  const [isFetchingSheet, setIsFetchingSheet] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = () => {
    setStep("upload");
    setFileName("");
    setCsvContent("");
    setPreviewHeaders([]);
    setPreviewRows([]);
    setTotalRowCount(0);
    setImportResult(null);
    setClientError(null);
    setIsSubmitting(false);
    setImportSource("csv");
    setGoogleSheetUrl("");
    setGoogleSheetTabName("Products");
    setIsFetchingSheet(false);
  };

  const handleModalClose = () => {
    resetState();
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processSelectedFile(file);
    }
  };

  const processSelectedFile = (file: File) => {
    setClientError(null);
    if (!file.name.endsWith(".csv") && !file.name.endsWith(".txt")) {
      setClientError("Please select a standard CSV file (.csv).");
      return;
    }

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content || content.trim().length === 0) {
        setClientError("The selected file is empty.");
        return;
      }

      setCsvContent(content);
      const parsed = CsvParser.parse(content);
      if (parsed.rows.length === 0) {
        setClientError("Could not find valid data rows in this CSV file.");
        return;
      }

      setPreviewHeaders(parsed.headers.slice(0, 6));
      setPreviewRows(parsed.rows.slice(0, 5));
      setTotalRowCount(parsed.rows.length);
      setStep("preview");
    };
    reader.onerror = () => {
      setClientError("Failed to read the file.");
    };
    reader.readAsText(file, "UTF-8");
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processSelectedFile(file);
    }
  };

  const executeImport = async () => {
    try {
      setIsSubmitting(true);
      setStep("importing");
      setClientError(null);

      const parsed = CsvParser.parse(csvContent);

      const res = await fetch("/api/v1/products/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          products: parsed.rows,
          options: {
            mode,
            auto_create_categories: autoCreateCategories,
            auto_generate_sku_if_missing: true,
          },
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || "Failed to process bulk import.");
      }

      const result: BulkImportResult = json.data;
      setImportResult(result);
      setStep("result");
      onSuccess();
    } catch (err: any) {
      setClientError(err.message || "Bulk import failed.");
      setStep("preview");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFetchGoogleSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!googleSheetUrl.trim()) {
      setClientError("Please enter a valid Google Spreadsheet link or ID.");
      return;
    }

    setClientError(null);
    setIsFetchingSheet(true);

    try {
      const res = await fetch("/api/v1/products/sheet-fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spreadsheet_url: googleSheetUrl.trim(),
          sheet_name: googleSheetTabName.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || "Failed to fetch Google Sheet.");
      }

      const rows: Record<string, string>[] = json.data.rows || [];
      const headers: string[] = json.data.headers || [];

      if (rows.length === 0) {
        throw new Error("The Google Sheet has no product rows.");
      }

      setFileName(`Google Sheet: ${json.data.spreadsheet_id.slice(0, 12)}... (${json.data.sheet_name})`);
      setCsvContent(CsvParser.stringify(rows));
      setPreviewHeaders(headers.slice(0, 6));
      setPreviewRows(rows.slice(0, 5));
      setTotalRowCount(json.data.total_rows || rows.length);
      setStep("preview");
    } catch (err: any) {
      setClientError(err.message || "Failed to connect to Google Sheet.");
    } finally {
      setIsFetchingSheet(false);
    }
  };

  const downloadErrorReportCsv = () => {
    if (!importResult || importResult.errors.length === 0) return;

    const errorRows = importResult.errors.map((err) => ({
      Row: err.row_index,
      SKU: err.sku || "N/A",
      Field: err.field || "general",
      Reason: err.reason,
      RawTitle: err.raw_data?.title || err.raw_data?.Title || "",
      RawPrice: err.raw_data?.base_price || err.raw_data?.Price || "",
    }));

    const csv = CsvParser.stringify(errorRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `import-errors-${importResult.batch_id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Modal isOpen={isOpen} onClose={handleModalClose} title="Bulk Product Import (CSV / Sheets)">
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {clientError && (
          <div
            style={{
              padding: "12px 16px",
              backgroundColor: "var(--color-danger-bg)",
              color: "var(--color-danger)",
              borderRadius: "var(--radius-control)",
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <AlertCircle size={16} />
            <span>{clientError}</span>
          </div>
        )}

        {/* STEP 1: UPLOAD OR GOOGLE SHEETS */}
        {step === "upload" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Mode Switcher Tabs */}
            <div
              style={{
                display: "flex",
                gap: "8px",
                borderBottom: "1px solid var(--color-border-subtle)",
                paddingBottom: "10px",
              }}
            >
              <button
                type="button"
                onClick={() => setImportSource("csv")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 14px",
                  borderRadius: "var(--radius-control)",
                  border: "none",
                  backgroundColor:
                    importSource === "csv" ? "var(--color-surface-dark)" : "transparent",
                  color:
                    importSource === "csv"
                      ? "var(--color-text-inverse)"
                      : "var(--color-text-secondary)",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                <FileSpreadsheet size={15} /> Upload CSV File
              </button>

              <button
                type="button"
                onClick={() => setImportSource("google_sheets")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 14px",
                  borderRadius: "var(--radius-control)",
                  border: "none",
                  backgroundColor:
                    importSource === "google_sheets"
                      ? "var(--color-surface-dark)"
                      : "transparent",
                  color:
                    importSource === "google_sheets"
                      ? "var(--color-text-inverse)"
                      : "var(--color-text-secondary)",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                <Share2 size={15} style={{ color: importSource === "google_sheets" ? "var(--color-lime-primary)" : "inherit" }} /> Sync Google Sheet
              </button>
            </div>

            {/* TAB A: CSV FILE UPLOAD */}
            {importSource === "csv" && (
              <>
                <div
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: "2px dashed var(--color-border-medium)",
                    borderRadius: "var(--radius-card)",
                    padding: "36px 20px",
                    textAlign: "center",
                    backgroundColor: "var(--color-surface-soft)",
                    cursor: "pointer",
                    transition: "border-color 0.2s, background-color 0.2s",
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    style={{ display: "none" }}
                    onChange={handleFileChange}
                  />
                  <UploadCloud
                    size={42}
                    style={{ color: "var(--color-text-secondary)", marginBottom: "12px" }}
                  />
                  <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--color-text-primary)" }}>
                    Drop your product catalog CSV here, or click to browse
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--color-text-muted)",
                      marginTop: "6px",
                    }}
                  >
                    Supports UTF-8 CSV files with 100 to 10,000+ SKUs. Automatic column header detection.
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "12px 16px",
                    backgroundColor: "var(--color-surface-soft)",
                    borderRadius: "var(--radius-control)",
                    border: "1px solid var(--color-border-subtle)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <FileSpreadsheet size={18} style={{ color: "var(--color-lime-primary)" }} />
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 600 }}>Need a standard template?</div>
                      <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                        Includes sample Panjabi, Saree, and Casual Wear catalog columns.
                      </div>
                    </div>
                  </div>
                  <a
                    href="/api/v1/products/template"
                    download="commerceos-product-import-template.csv"
                    style={{ textDecoration: "none" }}
                  >
                    <Button variant="outline" size="sm" type="button">
                      <Download size={14} style={{ marginRight: 6 }} /> Download Template
                    </Button>
                  </a>
                </div>
              </>
            )}

            {/* TAB B: GOOGLE SHEETS DIRECT SYNC */}
            {importSource === "google_sheets" && (
              <form onSubmit={handleFetchGoogleSheet} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)" }}>
                    Google Spreadsheet Link or ID
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      type="text"
                      placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs.../edit#gid=0"
                      value={googleSheetUrl}
                      onChange={(e) => setGoogleSheetUrl(e.target.value)}
                      required
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        borderRadius: "var(--radius-control)",
                        border: "1px solid var(--color-border-subtle)",
                        backgroundColor: "var(--color-surface-soft)",
                        fontSize: "13px",
                        color: "var(--color-text-primary)",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                    Paste your complete Google Sheet browser URL or just the Spreadsheet ID.
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)" }}>
                    Sheet Tab Name
                  </label>
                  <input
                    type="text"
                    placeholder="Products"
                    value={googleSheetTabName}
                    onChange={(e) => setGoogleSheetTabName(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "var(--radius-control)",
                      border: "1px solid var(--color-border-subtle)",
                      backgroundColor: "var(--color-surface-soft)",
                      fontSize: "13px",
                      color: "var(--color-text-primary)",
                      boxSizing: "border-box",
                    }}
                  />
                  <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                    Defaults to &quot;Products&quot;. Change if your sheet uses a different tab (e.g. &quot;Sheet1&quot; or &quot;Catalog&quot;).
                  </span>
                </div>

                <div
                  style={{
                    padding: "12px 14px",
                    backgroundColor: "var(--color-surface-soft)",
                    borderRadius: "var(--radius-control)",
                    border: "1px solid var(--color-border-subtle)",
                    fontSize: "12px",
                    color: "var(--color-text-secondary)",
                    lineHeight: "18px",
                  }}
                >
                  <div style={{ fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "4px" }}>
                    ✦ Sharing Requirement:
                  </div>
                  In Google Sheets, click the blue <strong>Share</strong> button and set General Access to{" "}
                  <strong style={{ color: "var(--color-text-primary)" }}>&quot;Anyone with the link can view&quot;</strong>. (Private sheets with API keys can also be configured in the Connector Hub).
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "4px" }}>
                  <Button variant="primary" size="md" type="submit" isLoading={isFetchingSheet}>
                    <RefreshCw size={14} style={{ marginRight: 6 }} /> Fetch &amp; Sync Sheet
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* STEP 2: PREVIEW & CONFIGURE */}
        {step === "preview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 14px",
                backgroundColor: "var(--color-surface-soft)",
                borderRadius: "var(--radius-control)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <FileText size={16} style={{ color: "var(--color-lime-primary)" }} />
                <span style={{ fontSize: "13px", fontWeight: 600 }}>{fileName}</span>
              </div>
              <Badge variant="default">{totalRowCount} Rows Detected</Badge>
            </div>

            {/* Preview Table */}
            <div style={{ overflowX: "auto", border: "1px solid var(--color-border-subtle)", borderRadius: "var(--radius-control)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <thead>
                  <tr style={{ backgroundColor: "var(--color-surface-soft)", textAlign: "left" }}>
                    {previewHeaders.map((header) => (
                      <th
                        key={header}
                        style={{
                          padding: "8px 12px",
                          borderBottom: "1px solid var(--color-border-subtle)",
                          fontWeight: 600,
                          color: "var(--color-text-secondary)",
                          textTransform: "capitalize",
                        }}
                      >
                        {header.replace(/_/g, " ")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
                      {previewHeaders.map((header) => (
                        <td
                          key={header}
                          style={{
                            padding: "8px 12px",
                            maxWidth: "180px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {row[header] || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Options */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                padding: "14px",
                backgroundColor: "var(--color-surface-soft)",
                borderRadius: "var(--radius-control)",
                fontSize: "13px",
              }}
            >
              <div style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>Import Strategy:</div>
              <div style={{ display: "flex", gap: "20px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="importMode"
                    value="upsert"
                    checked={mode === "upsert"}
                    onChange={() => setMode("upsert")}
                  />
                  <span>
                    <strong>Upsert</strong> (Update existing SKUs, create new ones)
                  </span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="importMode"
                    value="create_only"
                    checked={mode === "create_only"}
                    onChange={() => setMode("create_only")}
                  />
                  <span>
                    <strong>Create Only</strong> (Skip / flag if SKU exists)
                  </span>
                </label>
              </div>

              <div style={{ marginTop: "6px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={autoCreateCategories}
                    onChange={(e) => setAutoCreateCategories(e.target.checked)}
                  />
                  <span>Automatically create new categories if not present in catalog (Option A)</span>
                </label>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
              <Button variant="ghost" size="md" onClick={() => setStep("upload")}>
                Back
              </Button>
              <Button variant="primary" size="md" onClick={executeImport} isLoading={isSubmitting}>
                Start Ingestion <ArrowRight size={14} style={{ marginLeft: 6 }} />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: IMPORTING PROGRESS */}
        {step === "importing" && (
          <div style={{ padding: "40px 20px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "14px" }}>
            <RefreshCw size={36} className="animate-spin" style={{ color: "var(--color-lime-primary)" }} />
            <div style={{ fontSize: "16px", fontWeight: 600 }}>Ingesting Products &amp; Initializing Warehouses...</div>
            <div style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
              Validating rows, generating variants, and writing inventory ledgers.
            </div>
          </div>
        )}

        {/* STEP 4: RESULT SUMMARY */}
        {step === "result" && importResult && (
          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            {/* KPI Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
              <div style={{ padding: "12px", backgroundColor: "var(--color-surface-soft)", borderRadius: "var(--radius-control)", textAlign: "center" }}>
                <div style={{ fontSize: "11px", color: "var(--color-text-muted)", fontWeight: 600 }}>TOTAL ROWS</div>
                <div style={{ fontSize: "20px", fontWeight: 700 }}>{importResult.total_rows}</div>
              </div>
              <div style={{ padding: "12px", backgroundColor: "var(--color-success-bg)", borderRadius: "var(--radius-control)", textAlign: "center" }}>
                <div style={{ fontSize: "11px", color: "var(--color-success)", fontWeight: 600 }}>NEW CREATED</div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--color-success)" }}>{importResult.imported_count}</div>
              </div>
              <div style={{ padding: "12px", backgroundColor: "var(--color-info-bg)", borderRadius: "var(--radius-control)", textAlign: "center" }}>
                <div style={{ fontSize: "11px", color: "var(--color-info)", fontWeight: 600 }}>UPDATED</div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--color-info)" }}>{importResult.updated_count}</div>
              </div>
              <div style={{ padding: "12px", backgroundColor: importResult.failed_count > 0 ? "var(--color-danger-bg)" : "var(--color-surface-soft)", borderRadius: "var(--radius-control)", textAlign: "center" }}>
                <div style={{ fontSize: "11px", color: importResult.failed_count > 0 ? "var(--color-danger)" : "var(--color-text-muted)", fontWeight: 600 }}>REJECTED</div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: importResult.failed_count > 0 ? "var(--color-danger)" : "inherit" }}>{importResult.failed_count}</div>
              </div>
            </div>

            {/* Created Categories Badge */}
            {importResult.created_categories.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
                <Layers size={14} style={{ color: "var(--color-lime-primary)" }} />
                <span>Auto-created categories:</span>
                {importResult.created_categories.map((c) => (
                  <Badge key={c} variant="inventory">
                    {c}
                  </Badge>
                ))}
              </div>
            )}

            {/* Partial Failure Breakdown */}
            {importResult.errors.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-danger)" }}>
                    Validation Exceptions ({importResult.errors.length} rows skipped)
                  </div>
                  <Button variant="outline" size="sm" onClick={downloadErrorReportCsv}>
                    <Download size={13} style={{ marginRight: 4 }} /> Download Error CSV
                  </Button>
                </div>

                <div style={{ maxHeight: "160px", overflowY: "auto", border: "1px solid var(--color-border-subtle)", borderRadius: "var(--radius-control)" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                    <thead>
                      <tr style={{ backgroundColor: "var(--color-surface-soft)", textAlign: "left" }}>
                        <th style={{ padding: "6px 10px" }}>Row</th>
                        <th style={{ padding: "6px 10px" }}>SKU</th>
                        <th style={{ padding: "6px 10px" }}>Field</th>
                        <th style={{ padding: "6px 10px" }}>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importResult.errors.slice(0, 15).map((err, idx) => (
                        <tr key={idx} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
                          <td style={{ padding: "6px 10px", fontWeight: 600 }}>{err.row_index}</td>
                          <td style={{ padding: "6px 10px" }}>{err.sku || "—"}</td>
                          <td style={{ padding: "6px 10px", color: "var(--color-danger)" }}>{err.field}</td>
                          <td style={{ padding: "6px 10px" }}>{err.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "12px",
                  backgroundColor: "var(--color-success-bg)",
                  color: "var(--color-success)",
                  borderRadius: "var(--radius-control)",
                  fontSize: "13px",
                  fontWeight: 600,
                }}
              >
                <CheckCircle2 size={16} /> All products imported and synchronized successfully without errors!
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
              <Button variant="primary" size="md" onClick={handleModalClose}>
                Done &amp; View Catalog
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
