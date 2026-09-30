import { db } from "@/infrastructure/db";
import { logger } from "@/lib/logger";
import { secretProblems } from "@/lib/security";

/**
 * With DATA_BACKEND=pg the store loads from Postgres before requests are served; until then
 * `db.data` answers 503 STORE_NOT_READY. The JSON store is ready as soon as its module loads, so this returns at once.
 */
export async function loadStore(): Promise<void> {
  // Secrets fail closed on first use (ADR-103). Say so at start-up too, instead of only as a 500 at the first sign-in.
  const problems = secretProblems();
  if (problems.length) {
    logger.error("config.secrets_invalid", { problems });
    process.stderr.write(
      `CommerceOS: sign-in and stored credentials will not work until this is fixed in .env.local:\n` +
        problems.map((p) => `  - ${p}\n`).join("") +
        "  Use two different random values of 32+ characters (see .env.example).\n"
    );
  }
  // Don't hold server start-up forever on an unreachable database: the store keeps retrying in the background and
  // /health/ready reports not-ready meanwhile.
  await Promise.race([db.ready(), new Promise<void>((resolve) => setTimeout(resolve, 30_000).unref())]);
  // Outbound webhooks are delivered in the background once the store has loaded (FX-54)
  void db
    .ready()
    .then(async () => (await import("@/domains/enterprise/services/webhook-worker")).startWebhookWorker())
    .catch(() => undefined); // the store logs its own start-up failure
}
