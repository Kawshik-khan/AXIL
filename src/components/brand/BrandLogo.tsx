import type { SVGProps } from "react";
import { BRAND_BODY, BRAND_SPARK, BRAND_VIEWBOX } from "./brand-mark";
import { LogoMark } from "./LogoMark";

type BrandLogoProps = SVGProps<SVGSVGElement> & {
  size?: number;
  height?: number;
  tile?: boolean;
  label?: string;
};

/**
 * CommerceOS brand mark (Agent C). Without `tile` the bubble takes the surrounding text colour
 * (currentColor) and the spark stays lime with a currentColor outline, so it reads on light and dark
 * headers alike. With `tile` it renders the app-icon version on its ink tile.
 */
export function BrandLogo({ size, height, tile = false, label = "CommerceOS", ...props }: BrandLogoProps) {
  const dimension = size ?? height ?? 44;

  if (tile) {
    return <LogoMark size={dimension} label={label} edge {...props} />;
  }

  return (
    <svg width={dimension} height={dimension} viewBox={BRAND_VIEWBOX} role="img" aria-label={label} {...props}>
      <path d={BRAND_BODY} fill="currentColor" />
      <path
        d={BRAND_SPARK}
        stroke="currentColor"
        strokeWidth={3}
        strokeLinejoin="round"
        style={{ fill: "var(--color-logo-core)" }}
      />
    </svg>
  );
}
