/**
 * Early-access prices, per workspace and per month, in BDT. These mirror the plan versions seeded by the store
 * (`src/infrastructure/db/index.ts`, "Canonical SaaS Plans") and the only limit that differs between them and is
 * enforced today: staff users (`src/domains/platform/entitlement-catalog.ts`). Orders per month, automations,
 * n8n and priority support are not enforced yet, so they are deliberately not listed on the landing page.
 * tests/landing-routing-tests.ts fails when these drift from the seed. Keep the "may change" wording until billing is live.
 */
export interface LandingPlan {
  /** The seeded plan id, so the test can match it. */
  id: "FREE" | "STARTER" | "GROWTH" | "PRO";
  name: string;
  price: number;
  users: number;
  blurb: string;
  cta: "line" | "lime";
}

/** Formats a BDT amount the way the page shows it, e.g. ৳1,999. */
export const taka = (n: number): string => `৳${Math.round(n).toLocaleString("en-US")}`;

export const PLANS: readonly LandingPlan[] = [
  { id: "FREE", name: "Free", price: 0, users: 2, blurb: "Try CommerceOS with a very small team.", cta: "line" },
  { id: "STARTER", name: "Starter", price: 1999, users: 5, blurb: "A growing single-brand store.", cta: "lime" },
  { id: "GROWTH", name: "Growth", price: 4999, users: 15, blurb: "A bigger team working across channels.", cta: "lime" },
  { id: "PRO", name: "Pro", price: 9999, users: 50, blurb: "High-volume operations with many people.", cta: "lime" },
];
