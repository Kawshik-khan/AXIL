/**
 * One-time re-encryption of stored provider credentials (FIX_IMPLEMENTATION_PLAN FX-03 step 3, audit M14).
 *
 * Before Phase 0, channel / connector / integration credentials were encrypted with sha256(JWT_SECRET), and the
 * JWT secret was a value published in the repository. They are now encrypted with sha256(CREDENTIALS_ENCRYPTION_KEY).
 *
 * Run once, after putting the new JWT_SECRET and CREDENTIALS_ENCRYPTION_KEY in .env.local:
 *   1. Stop `npm run dev` — two processes writing the JSON store lose each other's updates.
 *   2. Temporarily add OLD_JWT_SECRET=<the previous JWT_SECRET value> to .env.local.
 *   3. Dry run (reports only):   node tests/ts-runner.cjs ./scripts/rotate-credential-key.ts
 *   4. Apply (backs up first):   node tests/ts-runner.cjs ./scripts/rotate-credential-key.ts --apply
 *   5. Remove OLD_JWT_SECRET from .env.local.
 *
 * Records whose ciphertext cannot be read with either key (e.g. the demo seed placeholders such as
 * "encrypted_fb_token_seed") are reported and — for channels and connectors — marked ERROR so they must be
 * reconnected. Nothing is invented for them.
 */
import crypto from "crypto";
import path from "path";
import { db } from "@/infrastructure/db";
import { encryptCredential, decryptCredential } from "@/lib/security";
import { backupStore, exitStore, openStore, saveStore } from "./lib/store-session";

void (async () => {
  await openStore();

  const out = (line: string) => process.stdout.write(`${line}\n`);
  const fail = async (line: string): Promise<never> => {
    process.stderr.write(`${line}\n`);
    return exitStore(1);
  };

  const apply = process.argv.includes("--apply");
  const legacySecret = process.env.OLD_JWT_SECRET;
  if (!legacySecret) {
    return fail("OLD_JWT_SECRET is not set. Add the previous JWT_SECRET value to .env.local for this run only.");
  }
  try {
    encryptCredential({ probe: true }); // fails early if CREDENTIALS_ENCRYPTION_KEY is missing or a default
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  function decryptWithLegacyKey(cipherText: string): Record<string, unknown> | null {
    try {
      const [ivHex, tagHex, dataHex] = cipherText.split(":");
      if (!ivHex || !tagHex || !dataHex) return null;
      const key = crypto.createHash("sha256").update(legacySecret as string).digest();
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
      decipher.setAuthTag(Buffer.from(tagHex, "hex"));
      const json = decipher.update(dataHex, "hex", "utf8") + decipher.final("utf8");
      return JSON.parse(json) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  function readableWithNewKey(cipherText: string): boolean {
    try {
      decryptCredential(cipherText);
      return true;
    } catch {
      return false;
    }
  }

  type Result = "reencrypted" | "already_current" | "unreadable";
  function classify(cipherText: string | undefined): { result: Result; next?: string } {
    if (!cipherText) return { result: "unreadable" };
    if (readableWithNewKey(cipherText)) return { result: "already_current" };
    const plain = decryptWithLegacyKey(cipherText);
    if (!plain) return { result: "unreadable" };
    return { result: "reencrypted", next: encryptCredential(plain) };
  }

  const counts: Record<Result, number> = { reencrypted: 0, already_current: 0, unreadable: 0 };
  const writes: Array<() => void> = [];
  const now = () => new Date().toISOString();

  for (const channel of db.data.connected_channels) {
    const { result, next } = classify(channel.credentials_encrypted);
    counts[result]++;
    out(`channel      ${channel.id} (${channel.tenant_id}): ${result}`);
    if (result === "reencrypted" && next) {
      writes.push(() => db.updateConnectedChannel(channel.tenant_id, channel.id, { credentials_encrypted: next }));
    } else if (result === "unreadable" && channel.type !== "WEBSITE_CHAT") {
      // Website chat keeps working without credentials (the browser widget is unsigned), so it is reported, not disabled.
      writes.push(() =>
        db.updateConnectedChannel(channel.tenant_id, channel.id, {
          status: "ERROR",
          error_message: "Stored credentials are unreadable (placeholder or unknown key). Reconnect this channel.",
        })
      );
    }
  }

  for (const connector of db.data.connector_configurations || []) {
    const { result, next } = classify(connector.credentials_encrypted);
    counts[result]++;
    out(`connector    ${connector.id} (${connector.tenant_id}): ${result}`);
    if (result === "reencrypted" && next) {
      writes.push(() => db.saveConnector({ ...connector, credentials_encrypted: next, updated_at: now() }));
    } else if (result === "unreadable") {
      writes.push(() => db.saveConnector({ ...connector, status: "ERROR", updated_at: now() }));
    }
  }

  for (const installation of db.data.integration_installations || []) {
    const { result, next } = classify(installation.credentials_encrypted);
    counts[result]++;
    out(`integration  ${installation.id}: ${result}`);
    if (result === "reencrypted" && next) {
      writes.push(() => db.updateIntegrationInstallation(installation.organization_id, installation.id, { credentials_encrypted: next }));
    }
  }

  out("");
  out(`re-encrypted: ${counts.reencrypted}   already current: ${counts.already_current}   unreadable: ${counts.unreadable}`);

  if (!apply) {
    out("Dry run only. Re-run with --apply to write these changes (a backup is taken first).");
    return exitStore(0);
  }

  const backupFile = backupStore("before-key-rotation");
  out(`Backup written: ${path.relative(process.cwd(), backupFile)}`);

  for (const write of writes) write();
  // Writes are flushed asynchronously (FX-20): confirm they reached disk before telling the operator anything.
  const saved = await saveStore();
  if (!saved.ok) {
    process.stderr.write(
      `Not saved: ${saved.reason}. Keep OLD_JWT_SECRET.\n`
    );
    return exitStore(1);
  }
  out(`Applied ${writes.length} change(s). Remove OLD_JWT_SECRET from .env.local now.`);
  out("The backup holds credentials encrypted under the old, published secret, so treat it as plaintext: delete it once");
  out("the app works, and rotate the provider tokens themselves (Meta, WhatsApp, couriers, payments) at each provider.");
  return exitStore(0);
})();
