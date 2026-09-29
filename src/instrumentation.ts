/**
 * Runs once when a Next.js server starts (ADR-108). With DATA_BACKEND=pg the store takes the writer lease and loads
 * from Postgres here, before requests are served; until then `db.data` answers 503 STORE_NOT_READY. The JSON store is
 * ready as soon as its module loads, so this is a no-op for it.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { db } = await import("@/infrastructure/db");
  // Don't hold server start-up forever on an unreachable database: the store keeps retrying in the background and
  // /health/ready reports not-ready meanwhile.
  await Promise.race([db.ready(), new Promise<void>((resolve) => setTimeout(resolve, 30_000).unref())]);
}
