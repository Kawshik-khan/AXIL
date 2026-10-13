"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Search, Sparkles, Send, HelpCircle, Users, BarChart3, RefreshCw } from "lucide-react";
import styles from "../intelligence.module.css";
import { LoadingSkeleton, EmptyState, ErrorState } from "@/components/ui/States/States";

const SUGGESTED_QUERIES = [
  "What is our 30-day sales revenue?",
  "Show me order volume today",
  "What is our average order value?",
  "What is the courier return-to-origin (RTO) rate?",
  "How much unreconciled COD volume is outstanding?",
];

export default function AnalyticsExplorerPage() {
  const [question, setQuestion] = useState("");
  const [nlResult, setNlResult] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Customer Intelligence & Cohort states
  const [customers, setCustomers] = useState<any[]>([]);
  const [cohorts, setCohorts] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  const loadData = async () => {
    setDataLoading(true);
    try {
      const [custRes, cohRes] = await Promise.all([
        fetch("/api/v1/intelligence/customers"),
        fetch("/api/v1/intelligence/cohorts"),
      ]);
      const [custJson, cohJson] = await Promise.all([custRes.json(), cohRes.json()]);
      setCustomers(custJson.data?.customers || []);
      setCohorts(cohJson.data?.cohorts || []);
    } catch {
      // Ignore background errors
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAsk = async (qText?: string) => {
    const q = qText || question;
    if (!q.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/intelligence/nl-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      if (!res.ok) throw new Error("Failed to process question");
      const json = await res.json();
      setNlResult(json.data);
    } catch (err: any) {
      setError(err.message || "Failed to answer question");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.headerTitle}>
            <Sparkles size={24} color="#C7F900" /> AI Analytics Explorer & Customer RFM
          </h1>
          <p className={styles.headerSubtitle}>
            Query commerce performance in natural language and inspect verified customer lifetime value & retention cohorts.
          </p>
        </div>
      </div>

      <div className={styles.navTabs}>
        <Link href="/intelligence" className={styles.navTab}>Executive Overview</Link>
        <Link href="/intelligence/insights" className={styles.navTab}>Insights & Anomalies</Link>
        <Link href="/intelligence/forecasts" className={styles.navTab}>Demand Forecasts</Link>
        <Link href="/intelligence/recommendations" className={styles.navTab}>Recommendations</Link>
        <Link href="/intelligence/simulation" className={styles.navTab}>What-If Sandbox</Link>
        <Link href="/intelligence/analytics" className={`${styles.navTab} ${styles.navTabActive}`}>AI Analytics Explorer</Link>
      </div>

      {/* Natural Language Query Box */}
      <div className={`${styles.bentoCard} ${styles.col12}`} style={{ marginBottom: 28 }}>
        <div className={styles.cardTitle}>
          <span>💬 Conversational Analytics Query</span>
          <span className={styles.badgeLime}>Deterministic Execution</span>
        </div>

        <div className={styles.queryInputContainer}>
          <input
            type="text"
            placeholder="Ask anything (e.g. 'What is our 30-day sales revenue?', 'Show me order volume today')..."
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAsk()}
            className={styles.queryInput}
          />
          <button className={styles.actionBtn} onClick={() => handleAsk()} disabled={loading}>
            <Send size={14} style={{ marginRight: 6 }} /> Ask
          </button>
        </div>

        {/* Suggestion Chips */}
        <div className={styles.querySuggestions}>
          <span className={styles.querySuggestionsLabel}>Try:</span>
          {SUGGESTED_QUERIES.map((sq, i) => (
            <button
              key={i}
              type="button"
              className={styles.querySuggestionBtn}
              onClick={() => {
                setQuestion(sq);
                handleAsk(sq);
              }}
            >
              {sq}
            </button>
          ))}
        </div>

        {/* Answer Box */}
        {loading && <div style={{ marginTop: 20 }}><LoadingSkeleton lines={2} height="80px" /></div>}
        {error && <div style={{ marginTop: 16, color: "#dc2626", fontSize: 13 }}>{error}</div>}
        {nlResult && !loading && (
          <div className={styles.groundedAnswerBox}>
            <div className={styles.groundedAnswerLabel}>✦ GROUNDED ANSWER</div>
            <div className={styles.groundedAnswerText}>{nlResult.grounded_answer}</div>
            <div className={styles.groundedAnswerMeta}>
              Interpreted Metric: <strong>{nlResult.interpreted_metric}</strong> • Period: {nlResult.parameters?.startDate} to {nlResult.parameters?.endDate}
            </div>
          </div>
        )}
      </div>

      {/* Row: Customer RFM Segmentation & Retention Cohorts */}
      <div className={styles.bentoGrid}>
        {/* Customer RFM Table */}
        <div className={`${styles.bentoCard} ${styles.col7}`}>
          <div className={styles.cardTitle}>
            <span><Users size={16} color="#3b4d00" style={{ marginRight: 6 }} /> Customer RFM Intelligence & LTV</span>
            <span className={styles.badgeNeutral}>{customers.length} Profiles</span>
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Segment</th>
                  <th>Observed LTV</th>
                  <th>Predicted LTV</th>
                  <th>Recency</th>
                </tr>
              </thead>
              <tbody>
                {customers.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--color-text-secondary)" }}>No customer records found</td></tr>
                ) : (
                  customers.slice(0, 5).map((c) => (
                    <tr key={c.id}>
                      <td>
                        <div className={styles.customerName}>{c.customer_name}</div>
                        <div className={styles.customerPhone}>{c.phone}</div>
                      </td>
                      <td>
                        <span className={
                          c.rfm_segment === "CHAMPIONS" || c.rfm_segment === "LOYAL_CUSTOMERS"
                            ? styles.badgeLime
                            : c.rfm_segment === "AT_RISK"
                            ? styles.badgeRed
                            : styles.badgeNeutral
                        }>
                          {c.rfm_segment}
                        </span>
                      </td>
                      <td>৳{c.observed_ltv_bdt?.toLocaleString()}</td>
                      <td>
                        <strong style={{ color: "#047857" }}>৳{c.estimated_ltv_bdt?.toLocaleString()}</strong>
                      </td>
                      <td style={{ color: "var(--color-text-secondary)" }}>{c.recency_days}d ago</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Acquisition Cohorts */}
        <div className={`${styles.bentoCard} ${styles.col5}`}>
          <div className={styles.cardTitle}>
            <span><BarChart3 size={16} color="#3b4d00" style={{ marginRight: 6 }} /> Customer Retention Cohorts</span>
            <span className={styles.badgeNeutral}>{cohorts.length} Cohorts</span>
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Cohort</th>
                  <th>Size</th>
                  <th>Month 0</th>
                  <th>Month 1</th>
                  <th>Month 2</th>
                </tr>
              </thead>
              <tbody>
                {cohorts.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--color-text-secondary)" }}>No cohort data recorded</td></tr>
                ) : (
                  cohorts.slice(0, 4).map((coh) => (
                    <tr key={coh.cohort_month}>
                      <td className={styles.cohortMonth}>{coh.cohort_month}</td>
                      <td style={{ color: "var(--color-text-secondary)" }}>{coh.cohort_size}</td>
                      <td>
                        {coh.periods?.[0]?.retention_rate_pct !== undefined ? (
                          <span className={styles.cohortRatePill}>{coh.periods[0].retention_rate_pct}%</span>
                        ) : "—"}
                      </td>
                      <td>
                        {coh.periods?.[1]?.retention_rate_pct !== undefined ? (
                          <span className={styles.cohortRatePill}>{coh.periods[1].retention_rate_pct}%</span>
                        ) : "—"}
                      </td>
                      <td>
                        {coh.periods?.[2]?.retention_rate_pct !== undefined ? (
                          <span className={styles.cohortRatePill}>{coh.periods[2].retention_rate_pct}%</span>
                        ) : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
