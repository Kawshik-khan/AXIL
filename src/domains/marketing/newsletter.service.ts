import crypto from "crypto";
import { db, type NewsletterSubscriptionRecord } from "@/infrastructure/db";

/** Trim and lowercase, so "  Ana@Shop.COM " and "ana@shop.com" are the same subscriber. */
export function normalizeNewsletterEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * A stable id per normalised email: concurrent sign-ups for one address (two servers on one Postgres) write the same
 * document key, so the store can never hold two records for it. The id is never returned to a client.
 */
function subscriptionId(email: string): string {
  return `nls_${crypto.createHash("sha256").update(email).digest("hex").slice(0, 32)}`;
}

export const NewsletterService = {
  /**
   * Records a consented landing-page sign-up. Idempotent: an address already on the list keeps its one record (and its
   * original consent time). Returns nothing, so callers cannot tell a new address from a known one. Nothing is emailed.
   */
  subscribe(input: { email: string; consent: true }): void {
    const email = normalizeNewsletterEmail(input.email);
    if (db.findNewsletterSubscriptionByEmail(email)) return;
    const now = new Date().toISOString();
    const record: NewsletterSubscriptionRecord = {
      id: subscriptionId(email),
      email,
      source: "landing",
      consented_at: now,
      created_at: now,
    };
    db.addNewsletterSubscription(record);
  },
};
