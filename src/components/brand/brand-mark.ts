/**
 * Geometry of the CommerceOS "Agent C" mark, on a 120-unit grid.
 *
 * A chat bubble shaped like a C (one r60 circle, an r22 counter, a square bottom-left tail), cut by two
 * 2.4-unit hairlines into three modules, with the four-point AI spark sitting in its opening.
 * Talks (bubble), thinks (spark), acts (the C closes around the order).
 * Static copies: public/images/logos/commerceos-agent-*.svg, src/app/icon.svg, src/app/apple-icon.png.
 */
export const BRAND_VIEWBOX = "0 0 120 120";

/** The bubble C as three modules separated by hairline gaps (real gaps, so it works on any background). */
export const BRAND_BODY =
  "M116.57 40A60 60 0 0 0 60 0A60 60 0 0 0 0.01 58.8L38.03 58.8A22 22 0 0 1 69.17 40Z" +
  "M0 61.2L0 120L58.8 120L58.8 81.97A22 22 0 0 1 38.03 61.2Z" +
  "M61.2 119.99A60 60 0 0 0 116.57 80L69.17 80A22 22 0 0 1 61.2 81.97Z";

/** The four-point AI spark (concave arcs, radius 19, centred at 101,60). */
export const BRAND_SPARK =
  "M101 41A19 19 0 0 0 120 60A19 19 0 0 0 101 79A19 19 0 0 0 82 60A19 19 0 0 0 101 41Z";
