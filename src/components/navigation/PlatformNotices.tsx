"use client";

import React, { useEffect, useState } from "react";
import { Megaphone, Wrench, X } from "lucide-react";
import styles from "./PlatformNotices.module.css";

interface Notice {
  id: string;
  kind: "ANNOUNCEMENT" | "MAINTENANCE";
  type: string;
  title: string;
  message: string;
  starts_at: string | null;
  ends_at: string | null;
}

const DISMISSED_KEY = "commerceos.dismissed-notices";

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

/** Announcements and maintenance notices the platform published for this workspace (GET /api/v1/announcements). */
export const PlatformNotices: React.FC = () => {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    setDismissed(readDismissed());
    let cancelled = false;
    fetch("/api/v1/announcements", { credentials: "include", cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { data?: unknown } | null) => {
        if (!cancelled && json && Array.isArray(json.data)) setNotices(json.data as Notice[]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = notices.filter((n) => !dismissed.includes(n.id));
  if (visible.length === 0) return null;

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(next.slice(-100)));
    } catch {
      // Storage unavailable: the notice comes back on the next load
    }
  };

  return (
    <div className={styles.stack} role="status">
      {visible.map((n) => {
        const tone = n.kind === "MAINTENANCE" || n.type === "WARNING" || n.type === "INCIDENT" ? styles.warning : styles.info;
        return (
          <div key={n.id} className={`${styles.notice} ${tone}`}>
            <span className={styles.icon} aria-hidden="true">
              {n.kind === "MAINTENANCE" ? <Wrench size={16} /> : <Megaphone size={16} />}
            </span>
            <div className={styles.body}>
              <strong>{n.title}</strong>
              <span>{n.message}</span>
              {n.kind === "MAINTENANCE" && (
                <span className={styles.when}>
                  {formatWhen(n.starts_at)} – {formatWhen(n.ends_at)} (Dhaka)
                </span>
              )}
            </div>
            <button type="button" className={styles.close} onClick={() => dismiss(n.id)} aria-label="Dismiss notice">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
