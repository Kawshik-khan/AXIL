/**
 * Re-encryption of enterprise integration credentials saved before Phase 3 (audit N14).
 *
 * Before FX-31, `IntegrationHubService.installIntegration` stored credentials as base64 JSON: readable by anyone with
 * the data file or a backup. They are now stored with `encryptCredential` (AES-256-GCM). This works out, for each
 * installation, what the one-time migration in `scripts/reencrypt-integration-credentials.ts` should do. Pure: it
 * never writes.
 */
import { decryptCredential, encryptCredential } from "@/lib/security";
import type { IntegrationInstallation } from "@/types/enterprise";

export type CredentialMigrationResult = "already_encrypted" | "reencrypted" | "empty" | "unreadable";

export interface CredentialMigrationPlan {
  installation_id: string;
  organization_id: string;
  result: CredentialMigrationResult;
  /** Changes to apply; absent when nothing needs to change. Never contains the plaintext. */
  update?: Partial<IntegrationInstallation>;
}

function isCurrentCiphertext(value: string): boolean {
  try {
    decryptCredential(value);
    return true;
  } catch {
    return false;
  }
}

/** The legacy format: base64 of a JSON object. Returns null for anything else. */
function decodeLegacyBase64(value: string): Record<string, unknown> | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function planCredentialMigration(installation: IntegrationInstallation): CredentialMigrationPlan {
  const head = { installation_id: installation.id, organization_id: installation.organization_id };
  const stored = installation.credentials_encrypted ?? "";
  if (!stored) return { ...head, result: "empty" };
  if (isCurrentCiphertext(stored)) return { ...head, result: "already_encrypted" };

  const legacy = decodeLegacyBase64(stored);
  if (legacy) {
    return { ...head, result: "reencrypted", update: { credentials_encrypted: encryptCredential(legacy) } };
  }
  // Neither format: clear it rather than keep an unknown blob, and ask for the integration to be reconnected
  return {
    ...head,
    result: "unreadable",
    update: {
      credentials_encrypted: "",
      status: "DISCONNECTED",
      last_error: "Stored credentials were unreadable and have been cleared. Reconnect this integration.",
    },
  };
}
