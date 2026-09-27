import crypto from "crypto";

/**
 * Identifier helpers (FIX_IMPLEMENTATION_PLAN FX-16, audit M4/L4/L6).
 * IDs used to end in a timestamp plus a non-cryptographic random fragment: predictable, and able to collide within a
 * millisecond.
 */

/** 12 random base-36-ish characters from a CSPRNG (≈ 62 bits), for the unique part of an ID. */
export function randomSuffix(length = 12): string {
  return crypto.randomBytes(16).toString("base64url").replace(/[-_]/g, "").toLowerCase().slice(0, length).padEnd(length, "0");
}

/** A new opaque identifier: `${prefix}_${32 hex characters}`. */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}
