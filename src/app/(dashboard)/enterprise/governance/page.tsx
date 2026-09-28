"use client";

import React, { useEffect, useState } from "react";
import {
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  GitCommit,
  CheckCircle2,
  Database,
  Lock,
  Cpu,
  Bot,
} from "lucide-react";
import styles from "../enterprise.module.css";
import { EnterpriseNav } from "../components/EnterpriseNav";
import { DataAsset, DataQualityIssue, EnterpriseAIBudget } from "@/types/enterprise";

export default function EnterpriseGovernancePage() {
  const [assets, setAssets] = useState<DataAsset[]>([]);
  const [issues, setIssues] = useState<DataQualityIssue[]>([]);
  const [qualityScore, setQualityScore] = useState<number | null>(null);
  const [budget, setBudget] = useState<EnterpriseAIBudget | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchGovernanceState = async () => {
    try {
      setLoading(true);
      const [govRes, qRes, aiRes] = await Promise.all([
        fetch("/api/v1/enterprise/governance"),
        fetch("/api/v1/enterprise/data-quality"),
        fetch("/api/v1/enterprise/ai-governance"),
      ]);

      const [govData, qData, aiData] = await Promise.all([
        govRes.json(),
        qRes.json(),
        aiRes.json(),
      ]);

      setAssets(govData.data?.assets || []);
      setIssues(qData.data?.issues || []);
      setQualityScore(typeof qData.data?.health_score_pct === "number" ? qData.data.health_score_pct : null);
      setBudget(aiData.data?.budget || null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGovernanceState();
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h1>
            <ShieldCheck size={28} color="#c7f900" />
            Data Governance, Quality & AI Limits
            <span className={styles.headerBadge}>Phase 9</span>
          </h1>
          <p className={styles.headerSubtitle}>
            Audit data sensitivity tiers, provenance graphs, automated defect scans, and token spend ceilings
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={fetchGovernanceState}>
            <RefreshCw size={14} />
            <span>Audit Now</span>
          </button>
        </div>
      </div>

      <EnterpriseNav />

      {/* Governance Stats Bento Grid */}
      <div className={styles.bentoGrid}>
        <div className={`${styles.col4} ${styles.statCard}`}>
          <div className={styles.statLabel}>Data Quality Score</div>
          <div className={styles.statValue} style={{ color: qualityScore !== null && qualityScore >= 90 ? "#c7f900" : "#f59e0b" }}>
            {qualityScore === null ? "—" : `${qualityScore}%`}
          </div>
          <div className={styles.statMeta}>
            {issues.length} open referential / missing field defects
          </div>
        </div>

        <div className={`${styles.col4} ${styles.statCard}`}>
          <div className={styles.statLabel}>Cataloged Data Assets</div>
          <div className={styles.statValue}>{assets.length}</div>
          <div className={styles.statMeta}>
            PII isolated • Retention policies active
          </div>
        </div>

        <div className={`${styles.col4} ${styles.statCard}`}>
          <div className={styles.statLabel}>Monthly AI Token Usage</div>
          <div className={styles.statValue}>
            {budget ? `${(budget.tokens_consumed_month / 1000).toFixed(0)}k` : "0"}
          </div>
          <div className={styles.statMeta}>
            Spend: ${budget?.monthly_spent_usd.toFixed(2) || "0.00"} of ${budget?.monthly_budget_usd || 100}
          </div>
        </div>
      </div>

      {/* Quality Issues & Data Assets Grid */}
      <div className={styles.bentoGrid}>
        {/* Left: Quality Defect Queue (6 cols) */}
        <div className={`${styles.col6} ${styles.card}`}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>
              <AlertTriangle size={18} color="#f59e0b" />
              Automated Data Quality Audit ({issues.length} defects)
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {issues.length > 0 ? (
              issues.map((iss) => (
                <div
                  key={iss.id}
                  style={{
                    padding: 12,
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 10,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b" }}>
                      {iss.severity} • {iss.entity_type}
                    </span>
                    <span style={{ fontSize: 11, color: "#9ca3af" }}>{iss.status}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#ffffff", marginBottom: 2 }}>{iss.description}</div>
                  <div style={{ fontSize: 11, color: "#6b7280" }}>Field: {iss.field_name}</div>
                </div>
              ))
            ) : (
              <div className={styles.emptyState} style={{ padding: "24px 0" }}>
                <CheckCircle2 size={32} color="#c7f900" />
                <p className={styles.emptyStateTitle} style={{ marginTop: 8, fontSize: 14 }}>
                  Zero Quality Defects Found
                </p>
                <p style={{ fontSize: 12 }}>All orders and product records satisfy structural rules.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Cataloged Data Assets (6 cols) */}
        <div className={`${styles.col6} ${styles.card}`}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>
              <Database size={18} color="#c7f900" />
              Enterprise Data Catalog ({assets.length} assets)
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {assets.map((asset) => (
              <div
                key={asset.id}
                style={{
                  padding: 12,
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, color: "#ffffff", fontSize: 13 }}>{asset.name}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color:
                        asset.classification === "RESTRICTED"
                          ? "#ef4444"
                          : asset.classification === "CONFIDENTIAL"
                          ? "#f59e0b"
                          : "#c7f900",
                      background: "rgba(255,255,255,0.05)",
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}
                  >
                    {asset.classification}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#9ca3af" }}>
                  Domain: {asset.domain} • Retention: {asset.retention_days} days • PII:{" "}
                  {asset.pii_contained ? "Yes (" + asset.pii_fields.join(", ") + ")" : "None"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
