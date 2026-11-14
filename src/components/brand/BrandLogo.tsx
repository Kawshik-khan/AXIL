import type { SVGProps } from "react";
import { HUB_BODY, HUB_CORE, HUB_VIEWBOX } from "./hub-mark";
import { LogoMark } from "./LogoMark";

type BrandLogoProps = SVGProps<SVGSVGElement> & {
  size?: number;
  height?: number;
  tile?: boolean;
  label?: string;
};

/**
 * CommerceOS brand mark (Hub). Without `tile` the body takes the surrounding text colour
 * (currentColor) and the core stays lime, so it reads on light and dark headers alike.
 * With `tile` it renders the app-icon version on its ink tile.
 */
export function BrandLogo({ size, height, tile = false, label = "CommerceOS", ...props }: BrandLogoProps) {
  const dimension = size ?? height ?? 44;

  if (tile) {
    return <LogoMark size={dimension} label={label} edge {...props} />;
  }

  return (
    <svg width={dimension} height={dimension} viewBox={HUB_VIEWBOX} role="img" aria-label={label} {...props}>
      <path d={HUB_BODY} fillRule="evenodd" fill="currentColor" />
      <circle {...HUB_CORE} style={{ fill: "var(--color-logo-core)" }} />
    </svg>
  );
}
