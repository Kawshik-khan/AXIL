"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { api } from "@/components/payments/api";
import styles from "./LaunchChecklist.module.css";

interface ChecklistItem {
  id: string;
  label: string;
  hint: string;
  done: boolean;
  href: string;
}

interface Status {
  needs_onboarding: boolean;
  show_checklist: boolean;
  checklist: ChecklistItem[];
  done_count: number;
}

const RADIUS = 28;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Dashboard card for a newly registered shop: "finish setting up" while onboarding is unfinished, then the launch
 * checklist (every item computed from real data by GET /api/v1/onboarding) until all are done or it is dismissed.
 * Renders nothing for shops that never went through onboarding, or when the status can't be read.
 */
export function LaunchChecklist() {
  const [status, setStatus] = useState<Status | null>(null);
  const [hiding, setHiding] = useState(false);

  useEffect(() => {
    void api<Status>("/api/v1/onboarding").then((result) => {
      if (result.ok && result.data) setStatus(result.data);
    });
  }, []);

  if (!status) return null;

  if (status.needs_onboarding) {
    return (
      <section className={`${styles.card} ${styles.resume}`} aria-label="Finish setting up your shop">
        <div className={styles.headText}>
          <h2 className={styles.title}>Finish setting up your shop</h2>
          <p className={styles.sub}>A few quick questions so your assistant can start answering customers.</p>
        </div>
        <Link href="/onboarding" className={styles.go}>
          Continue setup
        </Link>
      </section>
    );
  }

  if (!status.show_checklist) return null;

  const total = status.checklist.length;
  const nextId = status.checklist.find((item) => !item.done)?.id;
  const dismiss = async () => {
    setHiding(true);
    const result = await api("/api/v1/onboarding", { method: "PATCH", json: { dismiss_checklist: true } });
    if (result.ok) setStatus({ ...status, show_checklist: false });
    setHiding(false);
  };

  return (
    <section className={styles.card} aria-labelledby="launch-checklist-title">
      <div className={styles.head}>
        <svg className={styles.ring} width="68" height="68" viewBox="0 0 68 68" role="img" aria-label={`${status.done_count} of ${total} done`}>
          <circle className={styles.ringTrack} cx="34" cy="34" r={RADIUS} fill="none" strokeWidth="8" />
          <circle
            className={styles.ringValue}
            cx="34"
            cy="34"
            r={RADIUS}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${(status.done_count / total) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            transform="rotate(-90 34 34)"
          />
          <text className={styles.ringText} x="34" y="39" textAnchor="middle">
            {status.done_count}/{total}
          </text>
        </svg>
        <div className={styles.headText}>
          <h2 id="launch-checklist-title" className={styles.title}>
            Launch checklist
          </h2>
          <p className={styles.sub}>Ticked from your real settings. This card goes away when everything is done.</p>
        </div>
        <button type="button" className={styles.dismiss} onClick={() => void dismiss()} disabled={hiding}>
          Hide
        </button>
      </div>
      <ol className={styles.list}>
        {status.checklist.map((item) => (
          <li key={item.id} className={`${styles.item} ${item.done ? styles.itemDone : ""} ${item.id === nextId ? styles.itemNext : ""}`}>
            <span className={`${styles.dot} ${item.done ? styles.dotDone : ""}`} aria-hidden="true">
              {item.done && <Check size={13} strokeWidth={3.5} />}
            </span>
            <span className={styles.itemText}>
              <span className={styles.itemLabel}>
                {item.label}
                {item.done && <span className={styles.srOnly}> (done)</span>}
              </span>
              {!item.done && <span className={styles.itemHint}>{item.hint}</span>}
            </span>
            {!item.done && item.id !== "first_order" && (
              <Link href={item.href} className={`${styles.go} ${item.id === nextId ? "" : styles.goQuiet}`}>
                {item.id === nextId ? "Do it now" : "Open"}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
