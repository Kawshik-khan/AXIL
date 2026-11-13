"use client";

import React, { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import ws from "./WorkScreen.module.css";

/**
 * A panel that slides in from the right over a dimmed page: header, scrolling body, sticky footer.
 * Escape and the scrim close it; focus moves into it on open and back to where it was on close.
 * Pass `as="form"` with `onSubmit` to make the whole panel one form (the footer's submit button then works).
 */
export function SidePanel({
  title,
  subtitle,
  onClose,
  children,
  footer,
  as = "div",
  onSubmit,
  wide = false,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  as?: "div" | "form";
  onSubmit?: (event: React.FormEvent) => void;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // Focus the first field if there is one, else the panel itself
    const first = panelRef.current?.querySelector<HTMLElement>("[data-autofocus], input, select, textarea");
    (first ?? panelRef.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);

  const Tag = as;
  return (
    <>
      <div className={ws.scrim} onClick={onClose} aria-hidden="true" />
      <Tag
        ref={(el: HTMLElement | null) => {
          panelRef.current = el;
        }}
        className={`${ws.panel} ${wide ? ws.panelWide : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onSubmit={as === "form" ? onSubmit : undefined}
      >
        <div className={ws.panelHead}>
          <div>
            <h2 id={titleId} className={ws.sectionTitle}>
              {title}
            </h2>
            {subtitle && <p className={ws.sectionHint}>{subtitle}</p>}
          </div>
          <button type="button" className={ws.iconButton} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className={ws.panelBody}>{children}</div>
        {footer && <div className={ws.panelFoot}>{footer}</div>}
      </Tag>
    </>
  );
}
