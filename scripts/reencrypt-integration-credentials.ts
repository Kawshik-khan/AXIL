/**
 * One-time re-encryption of enterprise integration credentials saved before Phase 3 (audit N14).
 *
 * Installations created before FX-31 hold their credentials as base64 JSON, which is plaintext to anyone with the data
 * file or a backup. No API returns them any more; this encrypts them with CREDENTIALS_ENCRYPTION_KEY.
 *
 * Run once:
 *   1. Stop `npm run dev` (two processes writing the JSON store lose each other's updates; the script refuses anyway).
 *   2. Dry run (reports only):   node tests/ts-runner.cjs ./scripts/reencrypt-integration-credentials.ts
 *   3. Apply (backs up first):   node tests/ts-runner.cjs ./scripts/reencrypt-integration-credentials.ts --apply
 *   4. The backup still holds the base64 credentials: delete it once the app works, and rotate those provider keys.
 *
 * Credentials in neither format are cleared and the installation is marked DISCONNECTED, to be reconnected.
 */
import path from "path";
import { db } from "@/infrastructure/db";
import { encryptCredential } from "@/lib/security";
import { planCredentialMigration, type CredentialMigrationResult } from "@/domains/enterprise/services/credential-migration";
import { backupStore, exitStore, openStore, saveStore } from "./lib/store-session";

void (async () => {
  await openStore();

  const out = (line: string) => process.stdout.write(`${line}\n`);
  const apply = process.argv.includes("--apply");

  try {
    encryptCredential({ probe: true }); // fails early if CREDENTIALS_ENCRYPTION_KEY is missing or a default
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return exitStore(1);
  }

  const counts: Record<CredentialMigrationResult, number> = { already_encrypted: 0, reencrypted: 0, empty: 0, unreadable: 0 };
  const plans = (db.data.integration_installations || []).map(planCredentialMigration);
  for (const plan of plans) {
    counts[plan.result]++;
    out(`integration  ${plan.installation_id} (${plan.organization_id}): ${plan.result}`);
  }
  const changes = plans.filter((p) => p.update);

  out("");
  out(
    `re-encrypted: ${counts.reencrypted}   already encrypted: ${counts.already_encrypted}   empty: ${counts.empty}   ` +
      `unreadable (will be cleared): ${counts.unreadable}`
  );

  if (!apply) {
    out("Dry run only. Re-run with --apply to write these changes (a backup is taken first).");
    return exitStore(0);
  }
  if (changes.length === 0) {
    out("Nothing to change.");
    return exitStore(0);
  }

  const backupFile = backupStore("before-integration-reencrypt");
  out(`Backup written: ${path.relative(process.cwd(), backupFile)}`);

  for (const plan of changes) {
    db.updateIntegrationInstallation(plan.organization_id, plan.installation_id, plan.update ?? {});
  }
  // Writes are flushed asynchronously (FX-20): confirm they reached disk before reporting success.
  const saved = await saveStore();
  if (!saved.ok) {
    process.stderr.write(`Not saved: ${saved.reason}.\n`);
    return exitStore(1);
  }
  out(`Applied ${changes.length} change(s).`);
  out("The backup holds the old base64 credentials, i.e. plaintext: delete it once the app works, and rotate those keys.");
  return exitStore(0);
})();
