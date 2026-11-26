"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, LogOut, Settings, ShieldCheck, Users } from "lucide-react";
import { api, formatDate, type ApiFailure } from "@/components/payments/api";
import { SUBSCRIPTION_STATUS_LABEL, type Subscription, type WorkspaceUsage } from "@/components/billing/PlanCards";
import { PERMISSIONS } from "@/lib/permissions";
import { canAccessPath } from "./module-access";
import { avatarGradient, initialsOf, roleLabelOf } from "./identity";
import styles from "./DockAccount.module.css";

export interface DockAccountProps {
  userName: string;
  userEmail?: string;
  userRole?: string;
  tenantName?: string;
  /** Tenant permissions of the signed-in user; plan and usage need settings.read. */
  permissions?: string[];
  onLogout: () => void;
}

interface PlanOverview {
  subscription: Subscription | null;
  usage: WorkspaceUsage[];
}

type Tone = "ok" | "warn" | "full";

interface Meter {
  id: string;
  label: string;
  used: number;
  /** null = unlimited on this plan */
  cap: number | null;
  /** Share of the limit in use, 0-1; null when there is no limit to fill */
  ratio: number | null;
  perMonth: boolean;
}

const LINKS = [
  { label: "Settings", href: "/settings#workspace", icon: Settings },
  { label: "Team", href: "/settings#users", icon: Users },
  { label: "Security", href: "/settings#security", icon: ShieldCheck },
];

const HOVER_OPEN_MS = 120;
const HOVER_CLOSE_MS = 220;
const RING_RADIUS = 21;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

const fmt = (n: number) => n.toLocaleString("en-US");

function toMeters(usage: WorkspaceUsage[]): Meter[] {
  return usage.flatMap((u) => {
    if (u.kind === "FEATURE" || u.used === null) return [];
    const cap = typeof u.value === "number" ? u.value : u.value === false ? 0 : null;
    // A limit of 0 is full as soon as anything counts against it, and not a limit in use before that
    const ratio = cap === null ? null : cap > 0 ? Math.min(1, u.used / cap) : u.used > 0 ? 1 : 0;
    return [{ id: u.id, label: u.label.replace(/ per month$/i, ""), used: u.used, cap, ratio, perMonth: u.kind === "PERIOD_QUOTA" }];
  });
}

function toneOf(ratio: number | null): Tone {
  if (ratio === null || ratio < 0.8) return "ok";
  return ratio >= 1 ? "full" : "warn";
}

function remainingText(meter: Meter): string {
  if (meter.cap === null) return "Unlimited";
  if (meter.cap === 0) return "Not included in this plan";
  if (meter.used >= meter.cap) return "Limit reached";
  return `${fmt(meter.cap - meter.used)} left${meter.perMonth ? " this month" : ""}`;
}

function periodText(subscription: Subscription): string {
  if (subscription.status === "TRIAL") return `Trial ends ${formatDate(subscription.trial_ends_at ?? subscription.current_period_end)}`;
  const until = formatDate(subscription.current_period_end);
  // A plan an operator assigned may have no billing period
  if (!subscription.billing_period) return `Runs until ${until}`;
  return `${subscription.billing_period === "ANNUAL" ? "Yearly" : "Monthly"} · paid until ${until}`;
}

/**
 * The foot of the merchant dock: log out above the signed-in person's avatar. The ring around the avatar is the plan
 * limit closest to full; hovering or pressing the avatar opens the profile, the plan and every limit's use
 * (GET /api/v1/billing, the same numbers as Settings → Plan & billing).
 */
export const DockAccount: React.FC<DockAccountProps> = ({ userName, userEmail, userRole, tenantName, permissions, onLogout }) => {
  const canReadPlan = Boolean(permissions?.includes(PERMISSIONS.SETTINGS_READ));
  const canChangePlan = Boolean(permissions?.includes(PERMISSIONS.SETTINGS_UPDATE));
  const pathname = usePathname();
  const panelId = useId();

  const [overview, setOverview] = useState<PlanOverview | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  /** Pressed open: stays until pressed again, Escape or a press elsewhere. A hover-open panel closes on leave. */
  const [isPinned, setIsPinned] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    if (!canReadPlan) return;
    const result = await api<PlanOverview>("/api/v1/billing");
    if (result.ok && result.data) {
      setOverview(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  }, [canReadPlan]);

  const close = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
    setIsOpen(false);
    setIsPinned(false);
  }, []);

  // On arrival (for the ring) and again each time the panel opens, so it never shows an old count
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  useEffect(() => close(), [pathname, close]);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const focusInside = rootRef.current?.contains(document.activeElement);
      close();
      if (focusInside) triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, close]);

  const hover = (next: boolean) => (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse" || isPinned) return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setIsOpen(next), next ? HOVER_OPEN_MS : HOVER_CLOSE_MS);
  };

  const onPress = () => {
    window.clearTimeout(hoverTimer.current);
    if (isOpen && isPinned) {
      close();
      return;
    }
    setIsOpen(true);
    setIsPinned(true);
  };

  // Next's link changes the hash without a hashchange event, so an open settings page would stay on its tab
  const onLinkPress = (href: string) => (event: React.MouseEvent) => {
    close();
    if (pathname !== href.split("#")[0] || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    window.history.pushState(null, "", href);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };

  const onBlur = (event: React.FocusEvent) => {
    if (event.relatedTarget instanceof Node && !rootRef.current?.contains(event.relatedTarget)) close();
  };

  const meters = overview ? toMeters(overview.usage) : [];
  const tightest = meters.reduce<Meter | null>((top, m) => (m.ratio !== null && (top === null || m.ratio > (top.ratio ?? 0)) ? m : top), null);
  const ringRatio = tightest?.ratio ?? 0;
  const ringTone = toneOf(ringRatio);
  const subscription = overview?.subscription ?? null;
  const planName = subscription ? subscription.plan_name ?? subscription.plan_id : null;
  const avatarStyle = { background: avatarGradient(userName) };
  const initials = initialsOf(userName);
  const identityLine = [userRole ? roleLabelOf(userRole) : null, tenantName].filter(Boolean).join(" · ");
  const ringText = tightest && tightest.cap !== null ? `, ${tightest.label}: ${fmt(tightest.used)} of ${fmt(tightest.cap)} used` : "";

  return (
    <div className={styles.account} ref={rootRef} onBlur={onBlur}>
      <div className={styles.capsule}>
        <button type="button" className={styles.logout} onClick={onLogout} aria-label="Log out" title="Log out">
          <LogOut size={18} strokeWidth={2} aria-hidden="true" />
        </button>

        <div className={styles.hoverZone} onPointerEnter={hover(true)} onPointerLeave={hover(false)}>
          <button
            type="button"
            ref={triggerRef}
            className={styles.trigger}
            onClick={onPress}
            aria-expanded={isOpen}
            aria-controls={panelId}
            aria-label={`${userName}: account${planName ? `, ${planName} plan` : ""}${ringText}`}
          >
            <svg className={styles.ring} viewBox="0 0 46 46" aria-hidden="true">
              <circle className={styles.ringTrack} cx="23" cy="23" r={RING_RADIUS} />
              {ringRatio > 0 && (
                <circle
                  className={`${styles.ringFill} ${styles[`ring_${ringTone}`]}`}
                  cx="23"
                  cy="23"
                  r={RING_RADIUS}
                  strokeDasharray={`${Math.max(ringRatio, 0.02) * RING_LENGTH} ${RING_LENGTH}`}
                />
              )}
            </svg>
            <span className={styles.avatar} style={avatarStyle} aria-hidden="true">
              {initials}
            </span>
          </button>

          <div id={panelId} role="dialog" aria-label="Account, plan and usage" className={`${styles.panel} ${isOpen ? styles.panelOpen : ""}`}>
            <div className={styles.person}>
              <span className={`${styles.avatar} ${styles.avatarLarge}`} style={avatarStyle} aria-hidden="true">
                {initials}
              </span>
              <div className={styles.personText}>
                <span className={styles.personName}>{userName}</span>
                {userEmail && <span className={styles.personMeta}>{userEmail}</span>}
                {identityLine && <span className={styles.personMeta}>{identityLine}</span>}
              </div>
            </div>

            {!canReadPlan ? (
              <p className={styles.note}>
                Your role can&apos;t see the plan and its usage. That needs the <code>{PERMISSIONS.SETTINGS_READ}</code> permission.
              </p>
            ) : error && !overview ? (
              <div className={styles.note} role="alert">
                <p>{error.message}</p>
                {error.request_id && <p className={styles.requestId}>Request {error.request_id}</p>}
                <button type="button" className={styles.retry} onClick={() => void load()}>
                  Try again
                </button>
              </div>
            ) : !overview ? (
              <div className={styles.skeleton} role="status" aria-label="Loading plan and usage">
                <span className={styles.skeletonCard} />
                <span className={styles.skeletonLine} />
                <span className={styles.skeletonLine} />
                <span className={styles.skeletonLine} />
              </div>
            ) : (
              <>
                <section className={styles.plan} aria-label="Plan">
                  <div className={styles.planHead}>
                    <span className={styles.planName}>{planName ?? "No plan yet"}</span>
                    {subscription && (
                      <span className={`${styles.planStatus} ${styles[`status_${subscription.status}`]}`}>
                        {SUBSCRIPTION_STATUS_LABEL[subscription.status]}
                      </span>
                    )}
                  </div>
                  <div className={styles.planFoot}>
                    <span className={styles.planMeta}>{subscription ? periodText(subscription) : "Choose a plan to start."}</span>
                    <Link href="/settings/billing" className={styles.planAction} onClick={close}>
                      {!canChangePlan ? "View plan" : !subscription ? "Choose plan" : ringTone === "ok" ? "Manage" : "Upgrade"}
                      <ArrowUpRight size={14} strokeWidth={2.25} aria-hidden="true" />
                    </Link>
                  </div>
                </section>

                {meters.length > 0 && (
                  <section className={styles.usage} aria-label="Usage">
                    {meters.map((meter) => {
                      const tone = toneOf(meter.ratio);
                      return (
                        <div key={meter.id} className={styles.meter}>
                          <span className={styles.meterLabel}>{meter.label}</span>
                          <span className={styles.meterValue}>
                            {fmt(meter.used)}
                            {meter.cap !== null && <span className={styles.meterCap}> / {fmt(meter.cap)}</span>}
                          </span>
                          {meter.ratio !== null && (
                            <div
                              className={styles.track}
                              role="meter"
                              aria-label={meter.label}
                              aria-valuenow={Math.min(meter.used, meter.cap ?? meter.used)}
                              aria-valuemin={0}
                              aria-valuemax={meter.cap ?? undefined}
                              aria-valuetext={remainingText(meter)}
                            >
                              <div
                                className={`${styles.fill} ${styles[`fill_${tone}`]}`}
                                style={{ width: `${meter.used > 0 ? Math.max(meter.ratio * 100, 2) : 0}%` }}
                              />
                            </div>
                          )}
                          <span className={`${styles.meterNote} ${styles[`note_${tone}`]}`}>{remainingText(meter)}</span>
                        </div>
                      );
                    })}
                  </section>
                )}
              </>
            )}

            {canAccessPath("/settings", permissions) && (
              <nav className={styles.links} aria-label="Account links">
                {LINKS.map(({ label, href, icon: Icon }) => (
                  <Link key={href} href={href} className={styles.link} onClick={onLinkPress(href)}>
                    <Icon size={16} strokeWidth={2} aria-hidden="true" />
                    {label}
                  </Link>
                ))}
              </nav>
            )}

            <button type="button" className={styles.panelLogout} onClick={onLogout}>
              <LogOut size={16} strokeWidth={2} aria-hidden="true" />
              Log out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
