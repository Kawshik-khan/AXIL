"use client";

import React from "react";
import { ArrowRight, Check, CreditCard, Languages, MessageCircle, Store, Truck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/BrandLogo";
import styles from "./Setup.module.css";

export interface RailStep {
  id: string;
  name: string;
  /** Shown under a finished step: what the owner answered. */
  summary: string;
  /** Shown under the current step: what this step asks. */
  prompt: string;
}

const ICONS: LucideIcon[] = [Languages, Store, Truck, MessageCircle, CreditCard];

const RING_R = 27;
const RING_C = 2 * Math.PI * RING_R;

/**
 * The left column of shop setup: a progress ring and every step by name. Finished steps show the answer given and can
 * be opened again to change it; the current step is raised; the rest wait.
 */
export function StepRail({
  steps,
  current,
  onOpen,
  disabled,
  laterLabel,
}: {
  steps: RailStep[];
  current: number;
  onOpen: (id: string) => void;
  disabled: boolean;
  laterLabel: string;
}) {
  const done = Math.max(0, Math.min(current, steps.length));
  return (
    <nav className={styles.rail} aria-label="Setup steps">
      <div className={styles.railHead}>
        <div className={styles.railTitle}>
          <span className={styles.brand}>
            <BrandLogo size={26} tile /> CommerceOS
          </span>
          <h1>Shop setup</h1>
          <span>Saved as you go</span>
        </div>
        <svg className={styles.ring} viewBox="0 0 64 64" role="img" aria-label={`${done} of ${steps.length} steps done`}>
          <circle className={styles.ringTrack} cx="32" cy="32" r={RING_R} />
          <circle
            className={styles.ringFill}
            cx="32"
            cy="32"
            r={RING_R}
            transform="rotate(-90 32 32)"
            strokeDasharray={`${(done / steps.length) * RING_C} ${RING_C}`}
            opacity={done === 0 ? 0 : 1}
          />
          <text x="32" y="37" className={styles.ringText}>
            {done}/{steps.length}
          </text>
        </svg>
      </div>

      <p className={styles.railMobile} aria-hidden="true">
        Step {Math.min(current + 1, steps.length)} of {steps.length} · {steps[Math.min(current, steps.length - 1)]?.name}
      </p>

      <ol className={styles.steps}>
        {steps.map((step, i) => {
          const Icon = ICONS[i] ?? Store;
          const state = i < current ? "done" : i === current ? "now" : "next";
          return (
            <li key={step.id}>
              <button
                type="button"
                className={`${styles.step} ${styles[state]}`}
                aria-current={state === "now" ? "step" : undefined}
                disabled={state !== "done" || disabled}
                onClick={() => onOpen(step.id)}
              >
                <span className={styles.icon} aria-hidden="true">
                  {state === "done" ? <Check size={18} strokeWidth={2.6} /> : <Icon size={18} strokeWidth={1.9} />}
                </span>
                <span className={styles.stepText}>
                  <span className={styles.stepName}>{step.name}</span>
                  <span className={styles.stepSub}>{state === "done" ? step.summary : state === "now" ? step.prompt : "Up next"}</span>
                </span>
                {state === "now" && <ArrowRight className={styles.stepArrow} size={18} aria-hidden="true" />}
                {state === "done" && <span className={styles.srOnly}>, done. Open to change it</span>}
              </button>
              {i < steps.length - 1 && <span className={`${styles.joint} ${i < current ? styles.jointDone : ""}`} aria-hidden="true" />}
            </li>
          );
        })}
      </ol>

      <Link href="/" className={styles.later}>
        {laterLabel}
      </Link>
    </nav>
  );
}
