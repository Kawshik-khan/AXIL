import crypto from "crypto";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

/**
 * Secrets are resolved lazily and fail closed (ADR-103, audit C2/M14):
 * - JWT_SECRET signs every token; CREDENTIALS_ENCRYPTION_KEY encrypts stored provider credentials.
 * - Both must be at least 32 characters, must not be the value that was published in this repository,
 *   and must differ from each other. Outside tests there is no fallback value.
 * Lazy resolution keeps `next build` (which imports route modules) from failing on a build machine that has
 * no secrets, while every request that needs a key still fails until the secret is configured.
 */
const PUBLISHED_DEFAULT_SECRET_PREFIX = "commerceos_super_secret";
const TOKEN_ISSUER = "commerceos";

/** Every token type gets its own audience so one kind can never be replayed as another (audit C2). */
export const TOKEN_AUDIENCE = {
  tenant: "commerceos:tenant",
  platform: "commerceos:platform",
  stepUp: "commerceos:step-up",
  impersonation: "commerceos:impersonation",
  /** Password checked, TOTP still required (5 minutes). Never a session (FX-15). */
  mfaPending: "commerceos:mfa-pending",
} as const;

/** Stored for accounts that must not be able to log in until a real password is set. Never matches bcrypt. */
export const DISABLED_PASSWORD_HASH = "!disabled";

type SecretName = "JWT_SECRET" | "CREDENTIALS_ENCRYPTION_KEY";

function requireSecret(name: SecretName): string {
  const value = process.env[name];
  if (value && value.length >= 32 && !value.startsWith(PUBLISHED_DEFAULT_SECRET_PREFIX)) {
    return value;
  }
  if (process.env.NODE_ENV === "test") {
    return `test-only-${name}-`.padEnd(48, "x");
  }
  throw new Error(
    `${name} is missing, shorter than 32 characters, or set to a published default. Set a unique random value (see .env.example).`
  );
}

let jwtKeyCache: Uint8Array | null = null;
function jwtKey(): Uint8Array {
  if (!jwtKeyCache) {
    const jwtSecret = requireSecret("JWT_SECRET");
    if (jwtSecret === process.env.CREDENTIALS_ENCRYPTION_KEY) {
      throw new Error("JWT_SECRET and CREDENTIALS_ENCRYPTION_KEY must be different values.");
    }
    jwtKeyCache = new TextEncoder().encode(jwtSecret);
  }
  return jwtKeyCache;
}

let encryptionKeyCache: Buffer | null = null;
function encryptionKey(): Buffer {
  if (!encryptionKeyCache) {
    encryptionKeyCache = crypto.createHash("sha256").update(requireSecret("CREDENTIALS_ENCRYPTION_KEY")).digest();
  }
  return encryptionKeyCache;
}

async function verifyToken(token: string, audience: string) {
  const { payload } = await jwtVerify(token, jwtKey(), {
    algorithms: ["HS256"],
    issuer: TOKEN_ISSUER,
    audience,
  });
  return payload;
}

export const AUTH_COOKIE_NAME = "commerceos_session";

export interface SessionPayload {
  userId: string;
  tenantId: string;
  role: string;
  email: string;
  name: string;
  /** The user's session_version when signed; a bump revokes every older session (FX-15). */
  sv?: number;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

/** bcrypt only — no shared passwords, no hash-as-password, no special-cased hashes (audit C1). */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (typeof password !== "string" || typeof hash !== "string" || !hash.startsWith("$2")) {
    return false;
  }
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

export async function signSessionToken(claims: SessionPayload): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE.tenant)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(jwtKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const claims = await verifyToken(token, TOKEN_AUDIENCE.tenant);
    if (typeof claims.userId !== "string" || typeof claims.tenantId !== "string") {
      return null;
    }
    return {
      userId: claims.userId,
      tenantId: claims.tenantId,
      role: claims.role as string,
      email: claims.email as string,
      name: claims.name as string,
      sv: typeof claims.sv === "number" ? claims.sv : 1,
    };
  } catch {
    return null;
  }
}

/** URL-safe random token from the OS CSPRNG (audit M4). `length` is the number of output characters. */
export function generateSecureToken(length = 32): string {
  return crypto.randomBytes(Math.ceil((length * 3) / 4)).toString("base64url").slice(0, length);
}

/**
 * Encrypt arbitrary sensitive configuration/credentials using AES-256-GCM
 */
export function encryptCredential(data: Record<string, unknown>): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const jsonStr = JSON.stringify(data);
  let encrypted = cipher.update(jsonStr, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypt AES-256-GCM encrypted credentials payload
 */
export function decryptCredential<T = Record<string, unknown>>(cipherText: string): T {
  try {
    const parts = cipherText.split(":");
    if (parts.length !== 3) {
      throw new Error("Invalid cipher format");
    }
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return JSON.parse(decrypted) as T;
  } catch (err) {
    throw new Error(`Credential decryption failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Safely mask sensitive API keys or tokens for client consumption (e.g. "whsec_abcd...ef12")
 */
export function maskSecret(secret?: string): string {
  if (!secret) return "";
  if (secret.length <= 8) return "••••••••";
  const prefix = secret.slice(0, 4);
  const suffix = secret.slice(-4);
  return `${prefix}••••••••${suffix}`;
}

export const PLATFORM_AUTH_COOKIE_NAME = "commerceos_platform_session";

export interface PlatformSessionPayload {
  userId: string;
  email: string;
  name: string;
  platformRole: string;
  scope: "PLATFORM";
  mfaVerified: boolean;
  sessionId: string;
  /** The user's session_version when signed (FX-15). */
  sv: number;
}

export async function signPlatformSessionToken(
  claims: {
    userId: string;
    email: string;
    name?: string;
    platformRole: string;
    mfaVerified?: boolean;
    sessionId?: string;
    sv?: number;
  },
  expiresIn = "4h"
): Promise<string> {
  const sessionId = claims.sessionId || `sess_${crypto.randomUUID()}`;
  const name = claims.name || claims.email.split("@")[0];
  // MFA counts as verified only when a caller checked a real factor and says so explicitly (audit H10).
  const mfaVerified = claims.mfaVerified === true;

  return new SignJWT({
    ...claims,
    name,
    sessionId,
    mfaVerified,
    scope: "PLATFORM",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE.platform)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(jwtKey());
}

export async function verifyPlatformSessionToken(token: string): Promise<PlatformSessionPayload | null> {
  try {
    const claims = await verifyToken(token, TOKEN_AUDIENCE.platform);
    if (claims.scope !== "PLATFORM" || typeof claims.userId !== "string") {
      return null;
    }
    return {
      userId: claims.userId,
      email: claims.email as string,
      name: claims.name as string,
      platformRole: claims.platformRole as string,
      scope: "PLATFORM",
      mfaVerified: claims.mfaVerified === true,
      sessionId: typeof claims.sessionId === "string" ? claims.sessionId : "",
      sv: typeof claims.sv === "number" ? claims.sv : 1,
    };
  } catch {
    return null;
  }
}

/** Issued after a correct password for an operator with MFA; exchanged for a session only with a valid TOTP code. */
export async function signMfaPendingToken(userId: string): Promise<string> {
  return new SignJWT({ userId, scope: "MFA_PENDING" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE.mfaPending)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(jwtKey());
}

export async function verifyMfaPendingToken(token: string): Promise<{ userId: string } | null> {
  try {
    const claims = await verifyToken(token, TOKEN_AUDIENCE.mfaPending);
    if (claims.scope !== "MFA_PENDING" || typeof claims.userId !== "string") return null;
    return { userId: claims.userId };
  } catch {
    return null;
  }
}

export interface StepUpPayload {
  userId: string;
  scope: "STEP_UP";
  action: string;
  verifiedAt: string;
}

export async function signStepUpToken(userId: string, action = "PRIVILEGED_ACTION"): Promise<string> {
  return new SignJWT({
    userId,
    scope: "STEP_UP",
    action,
    verifiedAt: new Date().toISOString(),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE.stepUp)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(jwtKey());
}

export async function verifyStepUpToken(token: string, userId?: string): Promise<StepUpPayload | null> {
  try {
    const claims = await verifyToken(token, TOKEN_AUDIENCE.stepUp);
    if (claims.scope !== "STEP_UP") {
      return null;
    }
    if (userId && claims.userId !== userId) {
      return null;
    }
    return {
      userId: claims.userId as string,
      scope: "STEP_UP",
      action: claims.action as string,
      verifiedAt: claims.verifiedAt as string,
    };
  } catch {
    return null;
  }
}

export interface ImpersonationPayload {
  sessionId: string;
  impersonationSessionId?: string;
  operatorUserId: string;
  operatorId?: string;
  targetTenantId: string;
  targetUserId: string;
  mode: "READ_ONLY" | "MUTATION_APPROVED";
  scope: "IMPERSONATION";
  expiresAt?: string;
}

export async function signImpersonationToken(
  claims: {
    sessionId?: string;
    impersonationSessionId?: string;
    operatorUserId?: string;
    operatorId?: string;
    targetTenantId: string;
    targetUserId: string;
    mode: "READ_ONLY" | "MUTATION_APPROVED";
    expiresAt?: string;
  },
  expiresIn = "30m"
): Promise<string> {
  const sessionId = claims.sessionId || claims.impersonationSessionId || `imp_${crypto.randomUUID()}`;
  const operatorUserId = claims.operatorUserId || claims.operatorId || "";

  return new SignJWT({
    ...claims,
    sessionId,
    impersonationSessionId: sessionId,
    operatorUserId,
    operatorId: operatorUserId,
    scope: "IMPERSONATION",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE.impersonation)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(jwtKey());
}

export async function verifyImpersonationToken(token: string): Promise<ImpersonationPayload | null> {
  try {
    const claims = await verifyToken(token, TOKEN_AUDIENCE.impersonation);
    if (claims.scope !== "IMPERSONATION") {
      return null;
    }
    const sessionId = (claims.sessionId || claims.impersonationSessionId) as string;
    const operatorUserId = (claims.operatorUserId || claims.operatorId) as string;
    return {
      sessionId,
      impersonationSessionId: sessionId,
      operatorUserId,
      operatorId: operatorUserId,
      targetTenantId: claims.targetTenantId as string,
      targetUserId: claims.targetUserId as string,
      mode: (claims.mode as "READ_ONLY" | "MUTATION_APPROVED") || "READ_ONLY",
      scope: "IMPERSONATION",
      expiresAt: claims.expiresAt as string | undefined,
    };
  } catch {
    return null;
  }
}
