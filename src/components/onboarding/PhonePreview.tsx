"use client";

import React from "react";
import { ArrowRight, Check } from "lucide-react";
import styles from "./Onboarding.module.css";

export interface ChatLine {
  from: "customer" | "shop";
  text: string;
  /** Where a shop reply came from, shown under it (e.g. "Your assistant · test run"). */
  source?: string;
}

export const CATEGORY_LABELS: Record<string, string> = {
  CLOTHING: "Clothing",
  COSMETICS: "Cosmetics",
  FOOD: "Food",
  GADGETS: "Gadgets",
  HANDMADE: "Handmade",
  OTHER: "Shop",
};

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** The shop's greeting in the language the assistant will answer in. */
export function greeting(shopName: string, language: string): string {
  const name = shopName.trim() || "our shop";
  return language === "bn"
    ? `আসসালামু আলাইকুম! ${name}-এ স্বাগতম। সাইজ, দাম, ডেলিভারি বা পেমেন্ট নিয়ে জিজ্ঞেস করুন।`
    : `Assalamu alaikum! Welcome to ${name}. Ask me about sizes, prices, delivery or payment.`;
}

/**
 * The chat a customer has with the shop, on a phone, drawn from what the owner has entered so far. Decorative apart
 * from the try-it step, whose lines are real answers from the assistant (the step passes them in).
 */
export function PhonePreview({
  shopName,
  category,
  lines,
  waiting = false,
  typing = false,
  tag,
  ready = false,
  learned,
  compact = false,
}: {
  /** A smaller phone, for the "See what customers see" sheet on narrow screens. */
  compact?: boolean;
  shopName: string;
  category: string | null;
  lines: ChatLine[];
  /** Nothing learned yet: a blank header and the typing dots. */
  waiting?: boolean;
  typing?: boolean;
  tag: string;
  ready?: boolean;
  /** Small "learned" chips beside the phone. */
  learned?: { left?: string; right?: string };
}) {
  const name = shopName.trim();
  return (
    <div className={styles.preview} aria-label="Preview of your shop's chat">
      <p className={`${styles.tag} ${ready ? styles.tagReady : ""}`}>{tag}</p>
      <div className={`${styles.phone} ${compact ? styles.phoneCompact : ""}`}>
        <div className={styles.screen}>
          <div className={styles.chatHead}>
            {waiting || !name ? (
              <>
                <span className={`${styles.avatar} ${styles.avatarEmpty}`} aria-hidden="true" />
                <span style={{ display: "grid", gap: 6 }} aria-hidden="true">
                  <span className={styles.skeleton} style={{ width: 120 }} />
                  <span className={styles.skeleton} style={{ width: 78 }} />
                </span>
              </>
            ) : (
              <>
                <span className={styles.avatar} aria-hidden="true">
                  {initials(name)}
                </span>
                <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
                  <span className={styles.chatName}>{name}</span>
                  <span className={styles.chatMeta}>{category ? `${CATEGORY_LABELS[category] ?? "Shop"} · replies instantly` : "Replies instantly"}</span>
                </span>
              </>
            )}
          </div>
          <div className={styles.chatBody} aria-live="polite">
            {lines.map((line, i) =>
              line.from === "customer" ? (
                <div key={i} className={`${styles.bubble} ${styles.fromCustomer}`}>
                  {line.text}
                </div>
              ) : (
                <React.Fragment key={i}>
                  <div className={`${styles.bubble} ${styles.fromShop}`}>{line.text}</div>
                  {line.source && <span className={styles.source}>{line.source}</span>}
                </React.Fragment>
              ),
            )}
            {(waiting || typing) && (
              <span className={styles.typing} aria-label="Typing">
                <i />
                <i />
                <i />
              </span>
            )}
          </div>
          <div className={styles.chatInput} aria-hidden="true">
            <span>Message…</span>
            <span className={styles.sendDot}>
              <ArrowRight size={16} />
            </span>
          </div>
        </div>
      </div>
      {/* what the assistant has picked up so far, in a row under the phone */}
      <div className={styles.learnedRow} aria-hidden="true">
        {[learned?.left, learned?.right].filter(Boolean).map((text) => (
          <span key={text} className={styles.learned}>
            <span className={styles.tick}>
              <Check size={11} strokeWidth={3.5} />
            </span>
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}
