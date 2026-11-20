"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { useSetupGuide } from "./useSetupGuide";
import styles from "./LaunchChecklist.module.css";

const RADIUS = 28;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** The dashboard URL the navigation's "Setup guide" entry opens: unfolds the guide and scrolls to it. */
export const SETUP_GUIDE_HREF = "/?setup=open";

/**
 * Dashboard setup guide for a newly registered shop: "finish setting up" while onboarding is unfinished, then the
 * launch checklist (every item computed from real data by GET /api/v1/onboarding). "Hide" folds it into a slim bar;
 * it can always be unfolded again (here or from the navigation). It goes away for good only when every required item
 * is done. Renders nothing for shops that never went through onboarding, or when the status can't be read.
 */
export function LaunchChecklist() {
  // useSearchParams needs a Suspense boundary in the App Router
  return (
    <Suspense fallback={null}>
      <SetupGuide />
    </Suspense>
  );
}

function SetupGuide() {
  const { status, setCollapsed } = useSetupGuide();
  const router = useRouter();
  const openRequested = useSearchParams()?.get("setup") === "open";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anchor = useRef<HTMLElement>(null);

  const toggle = async (collapsed: boolean) => {
    setBusy(true);
    setError(null);
    const ok = await setCollapsed(collapsed);
    setBusy(false);
    if (!ok) setError("Couldn't save that. Try again.");
    return ok;
  };

  // Opened from the navigation (?setup=open), also while already on the dashboard: unfold and bring it into view
  useEffect(() => {
    if (!status || !openRequested) return;
    router.replace("/", { scroll: false });
    const reveal = () => anchor.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (status.show_checklist && status.checklist_collapsed) void toggle(false).then(() => requestAnimationFrame(reveal));
    else requestAnimationFrame(reveal);
  }, [status, openRequested]);

  if (!status) return null;

  if (status.needs_onboarding) {
    return (
      <section ref={anchor} className={`${styles.card} ${styles.resume}`} aria-label="Finish setting up your shop">
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

  const total = status.required_total;
  const done = status.required_done;
  const nextId = status.checklist.find((item) => !item.done && item.required)?.id;

  if (status.checklist_collapsed) {
    return (
      <section ref={anchor} className={styles.bar} aria-label="Setup guide">
        <span className={styles.barText}>
          <strong>Setup guide</strong> · {done} of {total} done
        </span>
        {error && (
          <span className={styles.barError} role="alert">
            {error}
          </span>
        )}
        <button type="button" className={styles.dismiss} onClick={() => void toggle(false)} disabled={busy} aria-expanded="false">
          Show <ChevronDown size={14} aria-hidden />
        </button>
      </section>
    );
  }

  return (
    <section ref={anchor} className={styles.card} aria-labelledby="launch-checklist-title">
      <div className={styles.head}>
        <svg className={styles.ring} width="68" height="68" viewBox="0 0 68 68" role="img" aria-label={`${done} of ${total} done`}>
          <circle className={styles.ringTrack} cx="34" cy="34" r={RADIUS} fill="none" strokeWidth="8" />
          <circle
            className={styles.ringValue}
            cx="34"
            cy="34"
            r={RADIUS}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${(done / Math.max(1, total)) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            transform="rotate(-90 34 34)"
          />
          <text className={styles.ringText} x="34" y="39" textAnchor="middle">
            {done}/{total}
          </text>
        </svg>
        <div className={styles.headText}>
          <h2 id="launch-checklist-title" className={styles.title}>
            Setup guide
          </h2>
          <p className={styles.sub}>Ticked from your real settings. It goes away by itself once everything required is done.</p>
          {error && (
            <p className={styles.barError} role="alert">
              {error}
            </p>
          )}
        </div>
        <button type="button" className={styles.dismiss} onClick={() => void toggle(true)} disabled={busy} aria-expanded="true">
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
                {!item.required && <span className={styles.optional}> · optional</span>}
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
