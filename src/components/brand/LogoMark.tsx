import type { SVGProps } from "react";
import { HUB_BODY, HUB_CORE, HUB_VIEWBOX } from "./hub-mark";

type LogoMarkProps = SVGProps<SVGSVGElement> & { size?: number; label?: string; edge?: boolean };

/**
 * CommerceOS app-icon mark: the Hub mark on its ink tile. Colours are fixed in every theme
 * (--color-logo-* in tokens.css). `edge` adds a faint outline for dark pages.
 */
export function LogoMark({ size = 30, label, edge = false, ...props }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={HUB_VIEWBOX}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...props}
    >
      <rect
        x="1"
        y="1"
        width="118"
        height="118"
        rx="34"
        style={{ fill: "var(--color-logo-tile)", stroke: edge ? "var(--color-logo-edge)" : "none", strokeWidth: 2 }}
      />
      <g transform="translate(24 24) scale(0.6)">
        <path d={HUB_BODY} fillRule="evenodd" style={{ fill: "var(--color-logo-body)" }} />
        <circle {...HUB_CORE} style={{ fill: "var(--color-logo-core)" }} />
      </g>
    </svg>
  );
}
