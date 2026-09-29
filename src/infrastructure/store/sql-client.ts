/**
 * The narrow SQL surface the store needs (ADR-108). The app talks to Neon through its WebSocket Pool (real
 * transactions, one connection per transaction); tests and rehearsals use PGlite (pglite-client.ts), which is real
 * Postgres compiled to WASM. Nothing outside src/infrastructure/store depends on either driver.
 */
import { Pool } from "@neondatabase/serverless";
import { envNumber } from "@/lib/env-number";

export interface SqlResult<Row> {
  rows: Row[];
  /** Rows changed by INSERT/UPDATE/DELETE, or rows returned by SELECT. */
  rowCount: number;
}

export interface SqlExecutor {
  query<Row = Record<string, unknown>>(text: string, params?: unknown[]): Promise<SqlResult<Row>>;
  /** Several statements without parameters, sent as one batch (a migration file, a TRUNCATE list). */
  exec(sql: string): Promise<void>;
}

export interface SqlClient extends SqlExecutor {
  readonly kind: "neon" | "pglite";
  /** BEGIN … COMMIT on one connection; ROLLBACK and rethrow on any error. Never retried or replayed. */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Postgres error fields the store reports (SQLSTATE code, constraint and table names). */
export interface PgErrorFields {
  code?: string;
  constraint?: string;
  table?: string;
  detail?: string;
}

export function pgErrorFields(err: unknown): PgErrorFields {
  if (!err || typeof err !== "object") return {};
  const e = err as Record<string, unknown>;
  const pick = (k: string) => (typeof e[k] === "string" ? (e[k] as string) : undefined);
  return { code: pick("code"), constraint: pick("constraint"), table: pick("table"), detail: pick("detail") };
}

/**
 * SQLSTATE classes 22 (data exception) and 23 (integrity constraint violation): the database rejected the data itself.
 * Retrying the same rows can't succeed, unlike a dropped connection.
 */
export function isDataRejected(err: unknown): boolean {
  const code = pgErrorFields(err).code;
  return typeof code === "string" && (code.startsWith("22") || code.startsWith("23"));
}

/** The store's connection string: the pooled URL when set, else DATABASE_URL. */
export function storeConnectionString(): string | null {
  return process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL || null;
}

export function createNeonSqlClient(connectionString: string): SqlClient {
  const pool = new Pool({ connectionString, max: envNumber("STORE_POOL_MAX", 5, 1) });
  const run = async <Row>(q: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>, text: string, params?: unknown[]) => {
    const result = await q(text, params);
    return { rows: result.rows as Row[], rowCount: result.rowCount ?? result.rows.length };
  };
  return {
    kind: "neon",
    query: <Row>(text: string, params?: unknown[]) => run<Row>((t, p) => pool.query(t, p as unknown[]), text, params),
    exec: async (sql) => {
      await pool.query(sql);
    },
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx: SqlExecutor = {
          query: <Row>(text: string, params?: unknown[]) => run<Row>((t, p) => client.query(t, p as unknown[]), text, params),
          exec: async (sql) => {
            await client.query(sql);
          },
        };
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
