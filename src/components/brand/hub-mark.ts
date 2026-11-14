/**
 * Geometry of the CommerceOS "Hub" mark, on a 120-unit grid (module 40, disc radius 20).
 *
 * Five discs merge into a plus sign (the system); four separate discs sit in the corners (the sales
 * channels: web, Facebook, Instagram, WhatsApp); the lime core sits in a seam ring at the centre.
 * Gaps are real holes (even-odd fill), so the mark works on any background.
 * Static copies: public/images/logos/commerceos-hub-*.svg, src/app/icon.svg.
 */
export const HUB_VIEWBOX = "0 0 120 120";

/** Plus sign of merged discs with radius-20 fillets, the four corner discs, and the seam ring (r 14–17) cut out. */
export const HUB_BODY =
  "M60 0A20 20 0 0 1 80 20A20 20 0 0 0 100 40A20 20 0 0 1 100 80A20 20 0 0 0 80 100A20 20 0 0 1 40 100" +
  "A20 20 0 0 0 20 80A20 20 0 0 1 20 40A20 20 0 0 0 40 20A20 20 0 0 1 60 0Z" +
  "M60 43A17 17 0 1 0 60 77A17 17 0 1 0 60 43Z" +
  "M60 46A14 14 0 1 0 60 74A14 14 0 1 0 60 46Z" +
  "M20 3A17 17 0 1 0 20 37A17 17 0 1 0 20 3Z" +
  "M100 3A17 17 0 1 0 100 37A17 17 0 1 0 100 3Z" +
  "M100 83A17 17 0 1 0 100 117A17 17 0 1 0 100 83Z" +
  "M20 83A17 17 0 1 0 20 117A17 17 0 1 0 20 83Z";

/** The lime core. */
export const HUB_CORE = { cx: 60, cy: 60, r: 10 } as const;
