"use client";

import React, { useState } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  Pause,
  Play,
  Flame,
  AlertTriangle,
  Lock,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import styles from "../autonomous.module.css";
import { AutonomousNav } from "../components/AutonomousNav";
import { AUTONOMOUS_SAFETY_BOUNDARIES } from "@/types/autonomous";

export default function GovernanceAndSafetyPage() {
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState("PRICING");

  // Report what the server did: these alerts used to announce success whatever happened (FX-30/FX-31).
  const postOrThrow = async (url: string, body: unknown) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
    }
  };

  const handlePauseDomain = async (domain: string) => {
    try {
      setActionLoading(true);
      await postOrThrow("/api/v1/autonomous/pause", { domain, reason: `Manual pause of ${domain} domain autonomy` });
      alert(`Autonomy paused for ${domain} domain.`);
    } catch (err) {
      alert(`Failed to pause domain autonomy: ${(err as Error).message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResumeDomain = async (domain: string) => {
    try {
      setActionLoading(true);
      await postOrThrow("/api/v1/autonomous/resume", { domain });
      alert(`Autonomy resumed for ${domain} domain.`);
    } catch (err) {
      alert(`Failed to resume domain autonomy: ${(err as Error).message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleKillSwitch = async () => {
    const confirmation = confirm("CRITICAL CAUTION: Are you sure you want to activate the EMERGENCY KILL SWITCH? This immediately halts all autonomous actions across the entire platform.");
    if (!confirmation) return;
    try {
      setActionLoading(true);
      // Was a call to a route that doesn't exist, followed by "ACTIVATED" regardless (FX-30).
      await postOrThrow("/api/v1/autonomous/pause", { level: "ALL", reason: "EMERGENCY_KILL_SWITCH_ACTIVATED" });
      alert("Kill switch recorded: autonomy is paused for all domains.");
    } catch (err) {
      alert(`The kill switch was NOT activated: ${(err as Error).message}`);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h1>
            <ShieldAlert size={28} color="#c7f900" />
            Governance & Safety Center
          </h1>
          <p className={styles.headerSubtitle}>
            Non-negotiable autonomous safety boundaries, emergency kill switches, and human authority control planes.
          </p>
        </div>
      </div>

      <AutonomousNav />

      {/* Emergency Control Deck */}
      <div className={`${styles.card} ${styles.col12}`} style={{ borderColor: "rgba(239, 68, 68, 0.4)", marginBottom: 24 }}>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle} style={{ color: "#ef4444" }}>
            <Flame size={18} color="#ef4444" />
            Emergency Control Deck (§43)
          </h3>
          <span className={`${styles.statusPill} ${styles.statusCritical}`}>HUMAN AUTHORITY FIRST</span>
        </div>
        <p style={{ fontSize: 13, color: "#9ca3af", marginBottom: 18 }}>
          Humans retain irrevocable authority at all times. Operators can halt individual domains, pause cross-domain workflows, or execute an emergency platform kill switch.
        </p>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <button className={`${styles.btn} ${styles.btnDanger}`} onClick={handleKillSwitch} disabled={actionLoading}>
            <Flame size={16} /> EMERGENCY KILL SWITCH (ALL)
          </button>

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
            <span style={{ fontSize: 13, color: "#9ca3af" }}>Domain:</span>
            <select
              value={selectedDomain}
              onChange={(e) => setSelectedDomain(e.target.value)}
              style={{ background: "#1c1d21", border: "1px solid rgba(255,255,255,0.12)", color: "#fff", padding: "8px 12px", borderRadius: 8 }}
            >
              <option value="PRICING">Pricing Operations</option>
              <option value="INVENTORY">Inventory Balancing</option>
              <option value="MARKETING">Outbound Marketing</option>
              <option value="FULFILLMENT">Courier Dispatch</option>
              <option value="PROCUREMENT">Procurement POs</option>
            </select>
            <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => handlePauseDomain(selectedDomain)} disabled={actionLoading}>
              <Pause size={14} /> Pause {selectedDomain}
            </button>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => handleResumeDomain(selectedDomain)} disabled={actionLoading}>
              <Play size={14} /> Resume {selectedDomain}
            </button>
          </div>
        </div>
      </div>

      {/* Safety Boundaries */}
      <div className={styles.bentoGrid}>
        <div className={`${styles.card} ${styles.col12}`}>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>
              <Lock size={16} color="#c7f900" />
              Prohibited Autonomous Self-Modifications (§44)
            </h3>
            <span className={`${styles.originBadge} ${styles.originAutonomous}`}>HARDCODED BOUNDARIES</span>
          </div>
          <p style={{ fontSize: 13, color: "#9ca3af", marginBottom: 16 }}>
            The autonomous platform strictly enforces zero tolerance for autonomous self-modification. Any attempt to execute the following actions automatically triggers an immediate security alert and rejection:
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            {AUTONOMOUS_SAFETY_BOUNDARIES.map((boundary, idx) => (
              <div key={boundary} className={styles.itemRow} style={{ marginBottom: 0 }}>
                <div className={styles.itemInfo}>
                  <div className={styles.itemTitle} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <ShieldCheck size={14} color="#22c55e" />
                    {boundary}
                  </div>
                  <div className={styles.itemSubtitle}>Rule #{idx + 1}: Irrevocable platform boundary constraint</div>
                </div>
                <span className={`${styles.statusPill} ${styles.statusHealthy}`}>ENFORCED</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
