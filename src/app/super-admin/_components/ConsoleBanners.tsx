"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { PLATFORM_PERMISSIONS } from "@/lib/permissions";
import { platformRequest } from "../_lib/platform-client";
import { CONSOLE_ROOT } from "../_lib/platform-module-access";
import { formatDateTime, humanize } from "../_lib/format";
import styles from "../super-admin.module.css";

interface KillSwitch {
  id: string;
  scope: string;
  target_id?: string;
  is_active: boolean;
  reason: string;
  activated_at?: string;
}

interface MaintenanceWindow {
  id: string;
  title: string;
  scheduled_start: string;
  scheduled_end: string;
  is_active?: boolean;
}

const REFRESH_MS = 60_000;

/**
 * Console-wide banners from live API state (plan §3.3): an active GLOBAL kill switch, other active switches, and
 * maintenance windows in progress. Each source is fetched only when the role can read it; nothing is assumed.
 */
export const ConsoleBanners: React.FC<{ permissions: readonly string[] }> = ({ permissions }) => {
  const canReadSafety = permissions.includes(PLATFORM_PERMISSIONS.SECURITY_READ);
  const canReadMaintenance = permissions.includes(PLATFORM_PERMISSIONS.MAINTENANCE_READ);
  const [switches, setSwitches] = useState<KillSwitch[]>([]);
  const [windows, setWindows] = useState<MaintenanceWindow[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      if (canReadSafety) {
        platformRequest<KillSwitch[]>("/api/v1/platform/safety/kill-switch")
          .then((res) => !cancelled && setSwitches(Array.isArray(res.data) ? res.data.filter((s) => s.is_active) : []))
          .catch(() => !cancelled && setSwitches([]));
      }
      if (canReadMaintenance) {
        platformRequest<MaintenanceWindow[]>("/api/v1/platform/maintenance?active=true")
          .then((res) => !cancelled && setWindows(Array.isArray(res.data) ? res.data.filter((w) => w.is_active) : []))
          .catch(() => !cancelled && setWindows([]));
      }
    };
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [canReadSafety, canReadMaintenance]);

  const global = switches.find((s) => s.scope === "GLOBAL");
  const scoped = switches.filter((s) => s.scope !== "GLOBAL");

  if (!global && scoped.length === 0 && windows.length === 0) return null;

  return (
    <div className={styles.sectionGap} role="status">
      {global && (
        <div className={`${styles.banner} ${styles.bannerDanger}`}>
          <span>
            GLOBAL kill switch is active since {formatDateTime(global.activated_at)} — every non-GET request is refused.
            Reason: {global.reason}
          </span>
          <Link href={`${CONSOLE_ROOT}/safety`}>Open Safety</Link>
        </div>
      )}
      {scoped.length > 0 && (
        <div className={`${styles.banner} ${styles.bannerWarning}`}>
          <span>
            {scoped.length} scoped kill switch{scoped.length === 1 ? "" : "es"} active:{" "}
            {scoped.map((s) => `${humanize(s.scope)}${s.target_id ? ` ${s.target_id}` : ""}`).join(", ")}
          </span>
          <Link href={`${CONSOLE_ROOT}/safety`}>Review</Link>
        </div>
      )}
      {windows.map((w) => (
        <div key={w.id} className={`${styles.banner} ${styles.bannerInfo}`}>
          <span>
            Maintenance in progress: {w.title} (until {formatDateTime(w.scheduled_end)})
          </span>
        </div>
      ))}
    </div>
  );
};
