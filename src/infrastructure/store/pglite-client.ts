/**
 * PGlite adapter for tests and local rehearsals (ADR-108): real Postgres compiled to WASM, in memory or in a local
 * directory. Dev dependency only; the app never imports this file (it uses Neon, see sql-client.ts).
 */
import { PGlite } from "@electric-sql/pglite";
import type { SqlClient, SqlExecutor, SqlResult } from "./sql-client";

interface PgliteQueryable {
  query<Row>(text: string, params?: unknown[]): Promise<{ rows: Row[]; affectedRows?: number }>;
  exec(sql: string): Promise<unknown>;
}

function executor(target: PgliteQueryable): SqlExecutor {
  return {
    query: async <Row>(text: string, params?: unknown[]): Promise<SqlResult<Row>> => {
      const result = await target.query<Row>(text, params);
      const isSelect = /^\s*(select|with|values|show)\b/i.test(text) || /\breturning\b/i.test(text);
      return { rows: result.rows, rowCount: isSelect ? result.rows.length : result.affectedRows ?? 0 };
    },
    exec: async (sql) => {
      await target.exec(sql);
    },
  };
}

/** `dataDir` omitted: an in-memory database that disappears with the process. */
export function createPgliteClient(dataDir?: string): SqlClient {
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  const ready = pg.waitReady;
  const base = executor(pg as unknown as PgliteQueryable);
  return {
    kind: "pglite",
    query: async (text, params) => {
      await ready;
      return base.query(text, params);
    },
    exec: async (sql) => {
      await ready;
      return base.exec(sql);
    },
    transaction: async (fn) => {
      await ready;
      return pg.transaction((tx) => fn(executor(tx as unknown as PgliteQueryable)));
    },
    close: async () => {
      await pg.close();
    },
  };
}
