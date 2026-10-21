/**
 * Moves "Connect with Facebook" channels onto connections and resources (ADR-119, docs/connection-platform-plan.md P2).
 * See src/domains/connectors/migrate-channels.ts for what changes. Nothing is sent to Meta.
 *
 *   1. Stop the app (the JSON store refuses while it is running; on Postgres the writer lease is taken).
 *   2. Dry run (reports only):   node tests/ts-runner.cjs ./scripts/migrate-channels-to-connections.ts
 *   3. Apply (backs up first):   node tests/ts-runner.cjs ./scripts/migrate-channels-to-connections.ts --apply
 * Running it again changes nothing.
 */
import path from "path";
import { migrateChannelsToConnections } from "@/domains/connectors/migrate-channels";
import { backupStore, exitStore, openStore, saveStore } from "./lib/store-session";

void (async () => {
  await openStore();
  const out = (line: string) => process.stdout.write(`${line}\n`);
  const apply = process.argv.includes("--apply");

  const plan = migrateChannelsToConnections(false);
  for (const line of plan.lines) out(line);
  if (!apply) {
    out("Dry run only. Re-run with --apply to write these changes (a backup is taken first).");
    return exitStore(0);
  }
  if (plan.migrated === 0) {
    out("Nothing to migrate.");
    return exitStore(0);
  }

  const backupFile = backupStore("before-channel-migration");
  out(`Backup written: ${path.relative(process.cwd(), backupFile)}`);
  const applied = migrateChannelsToConnections(true);
  // Writes are flushed asynchronously: confirm they were saved before reporting success
  const saved = await saveStore();
  if (!saved.ok) {
    process.stderr.write(`Not saved: ${saved.reason}. Restore from the backup if anything looks wrong.\n`);
    return exitStore(1);
  }
  out(`Applied: ${applied.migrated} channel(s), ${applied.connectionsCreated} new connection(s), ${applied.adAccountsBound} ad account(s).`);
  out("The backup holds encrypted credentials: keep it private and delete it once the inbox and Ad Manager work.");
  return exitStore(0);
})();
