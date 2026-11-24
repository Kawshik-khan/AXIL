import React from "react";
import Link from "next/link";
import { AlertTriangle, Bot, TrendingUp } from "lucide-react";
import { PERMISSIONS } from "@/lib/permissions";
import type { IntelligenceOverview, Section } from "./dashboard-data";
import { Panel } from "./Panel";
import { SectionState } from "./SectionState";
import styles from "./Dashboard.module.css";

interface Insight {
  tag: string;
  tone: string;
  icon: React.ReactNode;
  title: string;
  text: string;
  href: string;
}

/** The top risk, opportunity and recommendation; a kind with none is left out. */
function topInsights(data: IntelligenceOverview): Insight[] {
  const insights: Insight[] = [];
  const risk = data.top_risks?.[0];
  if (risk) {
    insights.push({
      tag: "Risk",
      tone: styles.toneRisk,
      icon: <AlertTriangle size={20} />,
      title: risk.title,
      text: risk.recommended_mitigation ?? risk.description,
      href: "/intelligence/insights",
    });
  }
  const opportunity = data.top_opportunities?.[0];
  if (opportunity) {
    insights.push({
      tag: "Opportunity",
      tone: styles.toneOpportunity,
      icon: <TrendingUp size={20} />,
      title: opportunity.title,
      text: opportunity.description,
      href: "/intelligence/insights",
    });
  }
  const advice = data.top_recommendations?.[0];
  if (advice) {
    insights.push({
      tag: "Recommendation",
      tone: styles.toneAdvice,
      icon: <Bot size={20} />,
      title: advice.title,
      text: advice.rationale ?? advice.description,
      href: "/intelligence/recommendations",
    });
  }
  return insights;
}

export const IntelligencePanel: React.FC<{ intelligence: Section<IntelligenceOverview> }> = ({ intelligence }) => (
  <Panel title="✦ Commerce intelligence" note="From your orders, stock and payments" link={{ href: "/intelligence", label: "See all" }}>
    <SectionState section={intelligence} resource="commerce intelligence" permission={PERMISSIONS.ANALYTICS_READ}>
      {(data) => {
        const insights = topInsights(data);
        if (insights.length === 0) return <p className={styles.empty}>No risks, opportunities or recommendations found in your data yet.</p>;
        return (
          <div className={styles.insights}>
            {insights.map((item) => (
              <div key={item.tag} className={styles.insight}>
                <span className={`${styles.insightIcon} ${item.tone}`} aria-hidden="true">
                  {item.icon}
                </span>
                <div className={styles.insightText}>
                  <span className={styles.note}>{item.tag}</span>
                  <strong>{item.title}</strong>
                  <span className={styles.insightDetail}>{item.text}</span>
                </div>
                <Link href={item.href} className={styles.linkPill} aria-label={`Review ${item.tag.toLowerCase()}: ${item.title}`}>
                  Review
                </Link>
              </div>
            ))}
          </div>
        );
      }}
    </SectionState>
  </Panel>
);
