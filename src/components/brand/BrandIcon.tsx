import React from "react";
import styles from "./BrandIcon.module.css";

/** Brands with a logo in public/images/icons/SVG (round, filled badges drawn on a 48×48 box). */
export type Brand = "facebook" | "instagram" | "whatsapp" | "telegram" | "bkash" | "sslcommerz" | "steadfast";

const ICON_DIR = "/images/icons/SVG";
const SRC: Record<Brand, string> = {
  facebook: `${ICON_DIR}/Facebook.svg`,
  instagram: `${ICON_DIR}/instragram.svg`,
  whatsapp: `${ICON_DIR}/whatsapp.svg`,
  telegram: `${ICON_DIR}/telegram.svg`,
  bkash: `${ICON_DIR}/Bkash.svg`,
  sslcommerz: `${ICON_DIR}/SSLACOMMERCE.svg`,
  steadfast: `${ICON_DIR}/steadfast.svg`,
};

const NAMES: Record<Brand, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  bkash: "bKash",
  sslcommerz: "SSLCommerz",
  steadfast: "Steadfast",
};

/**
 * The brand for a key used anywhere in the app: a channel type (FACEBOOK_MESSENGER, INSTAGRAM, WHATSAPP), a payment
 * method or gateway (BKASH, SSLCOMMERZ), a courier (STEADFAST) or a connector provider id (meta_graph, whatsapp_cloud).
 * Undefined when there is no logo for it, so callers keep their own fallback.
 */
export function brandFor(key: string | null | undefined): Brand | undefined {
  switch ((key ?? "").toUpperCase()) {
    case "FACEBOOK":
    case "FACEBOOK_MESSENGER":
    case "MESSENGER":
    case "META_GRAPH":
      return "facebook";
    case "INSTAGRAM":
      return "instagram";
    case "WHATSAPP":
    case "WHATSAPP_CLOUD":
      return "whatsapp";
    case "TELEGRAM":
      return "telegram";
    case "BKASH":
      return "bkash";
    case "SSLCOMMERZ":
      return "sslcommerz";
    case "STEADFAST":
      return "steadfast";
    default:
      return undefined;
  }
}

/**
 * A brand's logo. Decorative by default (the text beside it names the brand); pass `label` when the logo stands alone.
 */
export function BrandIcon({
  brand,
  size = 20,
  label,
  className = "",
}: {
  brand: Brand;
  size?: number;
  /** Accessible name, for a logo shown without its brand name next to it. */
  label?: string | true;
  className?: string;
}) {
  const alt = label === true ? NAMES[brand] : label ?? "";
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small static SVG, nothing for next/image to optimise
    <img
      className={`${styles.icon} ${className}`}
      src={SRC[brand]}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      width={size}
      height={size}
      draggable={false}
    />
  );
}
