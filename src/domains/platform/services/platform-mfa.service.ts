import { db } from "@/infrastructure/db";
import { encryptCredential, decryptCredential } from "@/lib/security";
import { generateTotpSecret, otpauthUri, verifyTotp } from "@/lib/totp";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { PlatformMembershipRecord } from "@/types/platform";

/**
 * TOTP multi-factor for platform operators (FIX_IMPLEMENTATION_PLAN FX-15, audit H10).
 * Secrets are encrypted at rest; a code's time-step is accepted once, so it can't be replayed within its window.
 */
export class PlatformMfaService {
  private static membership(userId: string): PlatformMembershipRecord {
    const membership = db.findPlatformMembershipByUserId(userId);
    if (!membership || !membership.is_active) {
      throw new NotFoundError("Platform operator", userId);
    }
    return membership;
  }

  private static readSecret(cipherText: string | undefined): string | null {
    if (!cipherText) return null;
    try {
      return decryptCredential<{ secret: string }>(cipherText).secret;
    } catch {
      return null;
    }
  }

  public static isEnrolled(userId: string): boolean {
    const membership = db.findPlatformMembershipByUserId(userId);
    return !!membership?.is_active && membership.mfa_enabled === true && !!membership.mfa_secret_encrypted;
  }

  /** Issues a new secret for an operator without MFA. Returned once; confirmed by confirmEnrollment. */
  public static startEnrollment(userId: string, email: string): { secret: string; otpauth_uri: string } {
    const membership = this.membership(userId);
    if (membership.mfa_enabled && membership.mfa_secret_encrypted) {
      throw new ConflictError("An authenticator is already set up for this operator.");
    }
    const secret = generateTotpSecret();
    db.savePlatformMembership({
      ...membership,
      mfa_pending_secret_encrypted: encryptCredential({ secret }),
      updated_at: new Date().toISOString(),
    });
    return { secret, otpauth_uri: otpauthUri(email, secret) };
  }

  /** Activates MFA once the operator proves their authenticator produces valid codes. */
  public static confirmEnrollment(userId: string, code: string): void {
    const membership = this.membership(userId);
    const pending = this.readSecret(membership.mfa_pending_secret_encrypted);
    if (!pending) {
      throw new AppError("MFA_ENROLLMENT_NOT_STARTED", "Start authenticator setup first.", 409);
    }
    const step = verifyTotp(pending, String(code ?? "").trim());
    if (step === null) {
      throw new AppError("INVALID_MFA_CODE", "The authenticator code is not valid.", 400); // not 401: the session is fine, the code is not
    }
    db.savePlatformMembership({
      ...membership,
      mfa_enabled: true,
      mfa_secret_encrypted: membership.mfa_pending_secret_encrypted,
      mfa_pending_secret_encrypted: undefined,
      mfa_last_step: step,
      mfa_enrolled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    logger.info("platform_mfa.enrolled", { user_id: userId });
  }

  /** Verifies a code for an enrolled operator. A step that was already used is refused (replay). */
  public static verifyCode(userId: string, code: string): boolean {
    const membership = db.findPlatformMembershipByUserId(userId);
    if (!membership?.is_active || !membership.mfa_enabled) return false;
    const secret = this.readSecret(membership.mfa_secret_encrypted);
    if (!secret) {
      logger.error("platform_mfa.secret_unreadable", { user_id: userId });
      return false;
    }
    const step = verifyTotp(secret, String(code ?? "").trim());
    if (step === null || (membership.mfa_last_step !== undefined && step <= membership.mfa_last_step)) {
      return false;
    }
    db.savePlatformMembership({ ...membership, mfa_last_step: step, updated_at: new Date().toISOString() });
    return true;
  }
}
