"use client";

import React from "react";
import { ExternalLink, Link2 } from "lucide-react";
import styles from "./ConnectorCard.module.css";
import { BrandIcon, type Brand } from "@/components/brand/BrandIcon";

export type ConnectorTone = "ok" | "warn" | "none";

/** Brand tiles for providers whose colours are known; every other provider gets a dark tile with its initials. */
const MARKS: Record<string, { text: string; className: string }> = {
  meta_graph: { text: "f", className: styles.markFacebook },
  whatsapp_cloud: { text: "W", className: styles.markWhatsapp },
  telegram: { text: "T", className: styles.markTelegram },
  tiktok_shop: { text: "Tk", className: styles.markTiktok },
  google_ads: { text: "G", className: styles.markGoogle },
  bkash: { text: "b", className: styles.markBkash },
  pathao: { text: "P", className: styles.markPathao },
  redx: { text: "RX", className: styles.markRedx },
  dhl_express: { text: "DHL", className: styles.markDhl },
};

/** Brand logos; a provider listed here shows its logo instead of the lettered tile. */
const LOGOS: Record<string, Brand> = {
  meta_graph: "facebook",
  whatsapp_cloud: "whatsapp",
  telegram: "telegram",
  bkash: "bkash",
  sslcommerz: "sslcommerz",
  steadfast: "steadfast",
};

/** A second logo tucked behind the first, for a connector that covers two brands (Meta: Facebook and Instagram). */
const SECOND_LOGOS: Record<string, Brand> = {
  meta_graph: "instagram",
};

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}

export interface CardAction {
  /** "text" = plain label (Disconnect, Manage); "pill" = small white button (Connect). */
  kind: "text" | "pill";
  label: string;
  onClick: () => void;
  disabled?: boolean;
  warn?: boolean;
}

export interface CardSwitch {
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** What flipping it does, for screen readers and the tooltip. */
  label: string;
}

/**
 * One connector, laid out like a tile in an integrations gallery: logo (with a live-state dot) and a link to the setup
 * guide, the name and what it does, the real state when there is one, then the action and an on/off switch. The
 * switch pauses or resumes the connection (POST /connectors/{id}/disable|enable); it never pretends to connect.
 */
export function ConnectorCard({
  providerId,
  name,
  description,
  tone,
  paused,
  stateText,
  action,
  toggle,
  onGuide,
}: {
  providerId: string;
  name: string;
  description: string;
  /** The live state: ok = running, warn = needs attention, none = not connected. */
  tone: ConnectorTone;
  paused: boolean;
  /** A short real-state line, e.g. "Active · Dhaka D2C Apparel Page" or "Reconnect needed". */
  stateText?: string;
  action: CardAction | null;
  toggle: CardSwitch;
  onGuide: () => void;
}) {
  const mark = MARKS[providerId];
  const logo = LOGOS[providerId];
  const secondLogo = SECOND_LOGOS[providerId];
  const dot = paused ? styles.dotPaused : tone === "ok" ? styles.dotOk : tone === "warn" ? styles.dotWarn : null;

  return (
    <article className={styles.card} aria-label={`${name}${stateText ? `: ${stateText}` : ""}`}>
      <div className={styles.body}>
        <div className={styles.top}>
          <span className={`${styles.markWrap} ${secondLogo ? styles.markWrapPair : ""}`} aria-hidden="true">
            {secondLogo && <BrandIcon brand={secondLogo} size={36} className={`${styles.logo} ${styles.logoSecond}`} />}
            {logo ? (
              <BrandIcon brand={logo} size={36} className={styles.logo} />
            ) : (
              <span className={`${styles.mark} ${mark?.className ?? ""}`}>{mark ? mark.text : initials(name)}</span>
            )}
            {dot && <span className={`${styles.dot} ${dot}`} />}
          </span>
          <button type="button" className={styles.linkOut} onClick={onGuide} aria-label={`${name} setup guide`} title="Setup guide">
            <ExternalLink size={14} />
          </button>
        </div>
        <div className={styles.text}>
          <h3 className={styles.name}>{name}</h3>
          <p className={styles.description}>{description}</p>
          {stateText && <span className={`${styles.state} ${tone === "warn" ? styles.stateWarn : ""}`}>{stateText}</span>}
        </div>
      </div>
      <div className={styles.footer}>
        {action ? (
          action.kind === "pill" ? (
            <button type="button" className={styles.pillAction} onClick={action.onClick} disabled={action.disabled}>
              <Link2 size={12} aria-hidden="true" />
              {action.label}
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.textAction} ${action.warn ? styles.textWarn : ""}`}
              onClick={action.onClick}
              disabled={action.disabled}
            >
              {action.label}
            </button>
          )
        ) : (
          <span className={styles.muted}>Coming soon</span>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={toggle.on}
          aria-label={toggle.label}
          title={toggle.label}
          className={`${styles.switch} ${toggle.on ? styles.switchOn : ""}`}
          onClick={toggle.onToggle}
          disabled={toggle.disabled}
        />
      </div>
    </article>
  );
}

export const connectorCardStyles = styles;
