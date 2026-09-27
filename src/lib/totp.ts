import crypto from "crypto";

/**
 * RFC 6238 TOTP (SHA-1, 30-second steps, 6 digits) for platform operator MFA (FIX_IMPLEMENTATION_PLAN FX-15, H10).
 * Compatible with standard authenticator apps. No third-party dependency.
 */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_MS = 30_000;

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/g, "").replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** A new random 160-bit secret, base32-encoded (the format authenticator apps expect). */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function totpStep(timeMs = Date.now()): number {
  return Math.floor(timeMs / STEP_MS);
}

function codeForStep(secretB32: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", base32Decode(secretB32)).update(msg).digest();
  const offset = h[h.length - 1] & 0x0f;
  return String((h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

export function generateTotp(secretB32: string, timeMs = Date.now()): string {
  return codeForStep(secretB32, totpStep(timeMs));
}

/**
 * Checks a code against the current step and one step either side (clock drift).
 * Returns the matched step so callers can refuse a step that was already used (replay protection), or null.
 */
export function verifyTotp(secretB32: string, code: string, timeMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(timeMs);
  for (const drift of [-1, 0, 1]) {
    const step = current + drift;
    if (crypto.timingSafeEqual(Buffer.from(codeForStep(secretB32, step)), Buffer.from(code))) return step;
  }
  return null;
}

export function otpauthUri(accountEmail: string, secretB32: string, issuer = "CommerceOS"): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
