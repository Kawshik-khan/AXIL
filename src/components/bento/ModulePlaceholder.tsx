"use client";

import React from "react";
import Link from "next/link";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { ArrowLeft, Clock } from "lucide-react";
import dashStyles from "@/app/(dashboard)/dashboard.module.css";

interface ModulePlaceholderProps {
  title: string;
  description: string;
  phase: string;
  features: string[];
}

export const ModulePlaceholder: React.FC<ModulePlaceholderProps> = ({
  title,
  description,
  phase,
  features,
}) => {
  return (
    <>
      <div className={dashStyles.pageHeader}>
        <div>
          <h1 className={dashStyles.pageTitle}>
            <span>{title}</span>
            <span style={{ fontSize: "14px", fontWeight: 400, color: "var(--color-text-muted)" }}>
              / {phase}
            </span>
          </h1>
          <p className={dashStyles.pageDescription}>{description}</p>
        </div>

        <Link href="/">
          <Button variant="outline" size="sm" icon={<ArrowLeft size={16} />}>
            Back to Overview
          </Button>
        </Link>
      </div>

      <BentoGrid>
        <BentoCard
          span={8}
          title={`${title} Module Specification`}
          subtitle={`Architected in Phase 0; Implementation in ${phase}`}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
              Phase 1 establishes the multi-tenant authenticated platform foundation. This module&apos;s
              authoritative schemas, API contracts, and operating rules are defined in the <code>.agent/</code> operating system.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <strong style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-muted)" }}>
                Planned Capabilities:
              </strong>
              {features.map((feat, idx) => (
                <div key={idx} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "var(--color-lime-primary)" }} />
                  <span>{feat}</span>
                </div>
              ))}
            </div>
          </div>
        </BentoCard>

        <BentoCard span={4} title="Release Status" subtitle="Roadmap & Exit Gate">
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "13px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--color-warning)" }}>
              <Clock size={18} />
              <strong>Scheduled in {phase}</strong>
            </div>
            <p style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
              Follows the non-negotiable architectural principle: Phase 1 establishes the secure shell before commerce mutations begin.
            </p>
            <div style={{ marginTop: "12px" }}>
              <Link href="/">
                <Button variant="primary" size="sm" fullWidth>
                  Return to Dashboard
                </Button>
              </Link>
            </div>
          </div>
        </BentoCard>
      </BentoGrid>
    </>
  );
};
