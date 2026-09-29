/**
 * Signatures on requests CommerceOS sends (enterprise webhooks, n8n calls; FX-54/FX-55, ADR-110). The same scheme as
 * the inbound check of FX-06, so receivers can reuse it:
 *
 *   X-CommerceOS-Timestamp: <unix seconds>
 *   X-CommerceOS-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
 *
 * A receiver recomputes the HMAC over the raw body, compares in constant time, and rejects timestamps older than
 * 5 minutes (replay).
 */
import crypto from "crypto";

export const SIGNATURE_HEADER = "X-CommerceOS-Signature";
export const TIMESTAMP_HEADER = "X-CommerceOS-Timestamp";
export const MAX_SIGNATURE_AGE_SECONDS = 300;

export function signOutbound(secret: string, body: string, timestampSeconds = Math.floor(Date.now() / 1000)): Record<string, string> {
  const mac = crypto.createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
  return { [TIMESTAMP_HEADER]: String(timestampSeconds), [SIGNATURE_HEADER]: `v1=${mac}` };
}

/** What a receiver does (used by tests and documented for integrators). */
export function verifyOutboundSignature(secret: string, body: string, timestamp: string | undefined, signature: string | undefined, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!timestamp || !signature || !/^\d{9,11}$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_SIGNATURE_AGE_SECONDS) return false;
  const expected = signOutbound(secret, body, Number(timestamp))[SIGNATURE_HEADER];
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
