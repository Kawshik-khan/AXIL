/**
 * Authenticator (TOTP) and step-up for workspace users (AI fix plan FX-97 Part A). Mirrors PlatformMfaService:
 * secrets encrypted at rest, a code's time step accepted once, and step-up tokens bound to the user's session version.
 *
 * Workspace step-up tokens carry the action prefix "WORKSPACE:"; the platform console refuses them and the workspace
 * refuses platform ones, so enrolling a workspace authenticator (which needs only the account password) can never
 * stand in for a platform operator's own second factor.
 */
import { createHash, randomBytes } from "crypto";
import { db } from "@/infrastructure/db";
import { decryptCredential, encryptCredential, signStepUpToken, verifyPassword, WORKSPACE_STEP_UP_PREFIX } from "@/lib/security";
import { generateTotpSecret, otpauthUri, verifyTotp } from "@/lib/totp";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";

const RECOVERY_CODE_COUNT = 10;

const hashRecoveryCode = (code: string) => createHash("sha256").update(code.replace(/[\s-]/g, "").toUpperCase()).digest("hex");

function readSecret(cipherText: string | undefined): string | null {
  if (!cipherText) return null;
  try {
    return decryptCredential<{ secret: string }>(cipherText).secret;
  } catch {
    return null;
  }
}

function activeUser(userId: string) {
  const user = db.findUserById(userId);
  if (!user || user.status !== "ACTIVE") throw new NotFoundError("User", userId);
  return user;
}

export class WorkspaceMfaService {
  public static isEnrolled(userId: string): boolean {
    const user = db.findUserById(userId);
    return user?.mfa_enabled === true && Boolean(user.mfa_secret_encrypted);
  }

  /** Starts authenticator setup. The account password is required again, so a stolen session alone can't enrol. */
  public static async startEnrollment(userId: string, password: string): Promise<{ secret: string; otpauth_uri: string }> {
    const user = activeUser(userId);
    if (!(await verifyPassword(password, user.password_hash))) {
      // 400, not 401: the session is fine, only the confirmation failed (a 401 would sign the user out)
      throw new AppError("INVALID_PASSWORD", "The password is not correct.", 400);
    }
    if (user.mfa_enabled && user.mfa_secret_encrypted) {
      throw new ConflictError("An authenticator is already set up for this account.");
    }
    const secret = generateTotpSecret();
    db.updateUser(userId, { mfa_pending_secret_encrypted: encryptCredential({ secret }) });
    return { secret, otpauth_uri: otpauthUri(user.email, secret) };
  }

  /** Turns the authenticator on once it produces a valid code, and returns the recovery codes (shown once). */
  public static confirmEnrollment(userId: string, code: string): { recovery_codes: string[] } {
    const user = activeUser(userId);
    const pending = readSecret(user.mfa_pending_secret_encrypted);
    if (!pending) throw new AppError("MFA_ENROLLMENT_NOT_STARTED", "Start authenticator setup first.", 409);
    const step = verifyTotp(pending, String(code ?? "").trim());
    if (step === null) throw new AppError("INVALID_MFA_CODE", "The authenticator code is not valid.", 400);
    const recovery = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const raw = randomBytes(5).toString("hex").toUpperCase(); // 40 bits each, single use
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
    db.updateUser(userId, {
      mfa_enabled: true,
      mfa_secret_encrypted: user.mfa_pending_secret_encrypted,
      mfa_pending_secret_encrypted: undefined,
      mfa_last_step: step,
      mfa_enrolled_at: new Date().toISOString(),
      mfa_recovery_hashes: recovery.map(hashRecoveryCode),
    });
    logger.info("workspace_mfa.enrolled", { user_id: userId });
    return { recovery_codes: recovery };
  }

  /**
   * Checks a 6-digit authenticator code (each time step once: no replay) or a recovery code (each one once).
   * Returns false on any mismatch; never says which part was wrong.
   */
  public static verifyCode(userId: string, code: string): boolean {
    const user = db.findUserById(userId);
    if (!user || user.status !== "ACTIVE" || !user.mfa_enabled) return false;
    const given = String(code ?? "").trim();
    if (/^\d{6}$/.test(given)) {
      const secret = readSecret(user.mfa_secret_encrypted);
      if (!secret) {
        logger.error("workspace_mfa.secret_unreadable", { user_id: userId });
        return false;
      }
      const step = verifyTotp(secret, given);
      if (step === null || (user.mfa_last_step !== undefined && step <= user.mfa_last_step)) return false;
      db.updateUser(userId, { mfa_last_step: step });
      return true;
    }
    const hash = hashRecoveryCode(given);
    const hashes = user.mfa_recovery_hashes ?? [];
    if (!given || !hashes.includes(hash)) return false;
    db.updateUser(userId, { mfa_recovery_hashes: hashes.filter((h) => h !== hash) });
    logger.warn("workspace_mfa.recovery_code_used", { user_id: userId, remaining: hashes.length - 1 });
    return true;
  }

  /** A 5-minute workspace step-up token for this user, bound to their current session version. */
  public static async issueStepUpToken(userId: string, action = "PRIVILEGED_ACTION"): Promise<string> {
    const user = activeUser(userId);
    return signStepUpToken(userId, `${WORKSPACE_STEP_UP_PREFIX}${action}`, user.session_version ?? 1);
  }
}
