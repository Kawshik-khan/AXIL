"use client";

import { useEffect, useRef } from "react";
import { shopfront, type FigureHandle } from "@/components/marketing/commerce-figures";
import { c } from "@/components/marketing/classes";
import styles from "./stage.module.css";

/**
 * The scene beside the sign-in and sign-up forms: a shop with its rolling shutter padlocked shut (the `shopfront`
 * hairline figure). It follows the form: the padlock jiggles while the request is out, and on success the lock opens,
 * drops away and the shutter rolls up onto lit shelves. Decorative: hidden from screen readers (the form announces
 * the outcome). `tag` overrides the small label under the shop for each state.
 */

export type SceneStatus = "idle" | "submitting" | "success" | "error";

const toState = (status: SceneStatus) => (status === "success" ? "unlocked" : status === "submitting" ? "checking" : "locked");

const DEFAULT_TAG = { idle: "Locked", busy: "Checking…", done: "Open" };

export function LockScene({ status, tag = DEFAULT_TAG }: { status: SceneStatus; tag?: { idle: string; busy: string; done: string } }) {
  const box = useRef<HTMLDivElement>(null);
  const shop = useRef<FigureHandle | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    shop.current = shopfront(el, { theme: "light", intensity: 0.7, label: "A shop with its shutter padlocked shut" });
    return () => {
      shop.current?.destroy();
      shop.current = null;
    };
  }, []);

  useEffect(() => {
    shop.current?.update({ state: toState(status) });
  }, [status]);

  return (
    <div className={`${styles.scene} ${c("on-card")}`} aria-hidden="true">
      <div ref={box} className={styles.shop} />
      <p className={styles.lockState}>{status === "success" ? tag.done : status === "submitting" ? tag.busy : tag.idle}</p>
    </div>
  );
}
