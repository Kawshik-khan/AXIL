"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { Sparkles, X } from "lucide-react";
import { canAccessPath } from "@/components/navigation/module-access";
import styles from "./AssistantCard.module.css";

// The card (and its chat code) loads on the first open, so every dashboard page doesn't carry it.
const AssistantCard = dynamic(() => import("./AssistantCard").then((m) => m.AssistantCard), { ssr: false });

interface AssistantLauncherProps {
  permissions: readonly string[] | undefined;
  /** A read-only support session: the history shows, asking is off (a question is a write). */
  readOnly: boolean;
}

/**
 * The floating "Ask your shop" orb in the dashboard shell. It opens a glass chat card that stays open, with its
 * conversation, while the owner moves between pages. Shown only to roles that can open /assistant, and not on that page.
 */
export function AssistantLauncher({ permissions, readOnly }: AssistantLauncherProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const orbRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    orbRef.current?.focus();
  }, []);

  const onFullPage = pathname === "/assistant" || pathname.startsWith("/assistant/");

  useEffect(() => {
    if (onFullPage) setOpen(false);
  }, [onFullPage]);

  if (!canAccessPath("/assistant", permissions) || onFullPage) return null;

  return (
    <>
      {mounted && <AssistantCard open={open} onClose={close} readOnly={readOnly} />}
      <button
        ref={orbRef}
        type="button"
        className={`${styles.orbButton} ${open ? styles.orbButtonOpen : ""}`}
        aria-label={open ? "Close Ask your shop" : "Ask your shop"}
        aria-expanded={open}
        aria-controls="ask-your-shop-card"
        onClick={() => {
          setMounted(true);
          setOpen((o) => !o);
        }}
      >
        <span className={styles.orbSphere} aria-hidden="true" />
        <span className={styles.orbIcon} aria-hidden="true">
          {open ? <X size={22} /> : <Sparkles size={22} />}
        </span>
        {!open && <span className={styles.orbTip}>Ask your shop</span>}
      </button>
    </>
  );
}
