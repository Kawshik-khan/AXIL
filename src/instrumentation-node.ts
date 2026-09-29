import { db } from "@/infrastructure/db";

/**
 * With DATA_BACKEND=pg the store takes the writer lease and loads from Postgres before requests are served; until then
 * `db.data` answers 503 STORE_NOT_READY. The JSON store is ready as soon as its module loads, so this returns at once.
 */
export async function loadStore(): Promise<void> {
  // Don't hold server start-up forever on an unreachable database: the store keeps retrying in the background and
  // /health/ready reports not-ready meanwhile.
  await Promise.race([db.ready(), new Promise<void>((resolve) => setTimeout(resolve, 30_000).unref())]);
}
