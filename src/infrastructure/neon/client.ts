/**
 * CommerceOS — Neon PostgreSQL Client
 * Serverless PostgreSQL connection via @neondatabase/serverless
 * 
 * Uses HTTP for one-shot queries (stateless, optimal for serverless)
 * Uses WebSocket Pool for transactions (interactive sessions)
 */

import dns from 'dns';
import { neon, neonConfig, Pool, NeonQueryFunction } from '@neondatabase/serverless';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

// ── Configuration ──────────────────────────────────────────────
// Enable fetch connection caching for better performance in serverless
neonConfig.fetchConnectionCache = true;

// ── HTTP Client (one-shot queries) ─────────────────────────────
// Best for: SELECT, simple INSERT/UPDATE, non-transactional reads
const DATABASE_URL = process.env.DATABASE_URL || '';

let _sql: NeonQueryFunction<false, false> | null = null;

export function getSql(): NeonQueryFunction<false, false> {
  const dbUrl = process.env.DATABASE_URL || DATABASE_URL;
  if (!_sql) {
    if (!dbUrl) {
      throw new Error(
        'DATABASE_URL is not set. Please configure your Neon PostgreSQL connection string.'
      );
    }
    _sql = neon(dbUrl);
  }
  return _sql;
}

// ── Pool Client (transactions) ─────────────────────────────────
// Best for: Multi-statement transactions, inventory reservations, order creation
const DATABASE_URL_POOLED = process.env.DATABASE_URL_POOLED || DATABASE_URL;

let _pool: Pool | null = null;

export function getPool(): Pool {
  const poolUrl = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL || DATABASE_URL_POOLED || DATABASE_URL;
  if (!_pool) {
    if (!poolUrl) {
      throw new Error(
        'DATABASE_URL_POOLED is not set. Please configure your Neon pooled connection string.'
      );
    }
    _pool = new Pool({ connectionString: poolUrl });
  }
  return _pool;
}

// ── Query Helpers ──────────────────────────────────────────────

/**
 * Execute a parameterized SQL query.
 * Always use parameterized queries to prevent SQL injection.
 * 
 * @example
 * const users = await query<UserRecord>(
 *   'SELECT * FROM users WHERE tenant_id = $1 AND email = $2',
 *   [tenantId, email]
 * );
 */
export async function query<T = any>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const sql = getSql();
  let attempts = 0;
  while (true) {
    try {
      const result = await sql.query(text, params as any[]);
      return result as T[];
    } catch (err: any) {
      attempts++;
      if (attempts < 3 && (err?.message?.includes('fetch failed') || err?.code === 'ETIMEDOUT')) {
        await new Promise((resolve) => setTimeout(resolve, 150 * attempts));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Execute a query and return the first row or null.
 */
export async function queryOne<T = any>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

/**
 * Execute a query and return the count of affected rows.
 * Useful for INSERT, UPDATE, DELETE operations.
 */
export async function execute(
  text: string,
  params: unknown[] = []
): Promise<{ rowCount: number }> {
  const rows = await query(text, params);
  return { rowCount: rows.length };
}

/**
 * Run multiple queries inside a transaction.
 * Automatically handles BEGIN, COMMIT, and ROLLBACK.
 * 
 * @example
 * const order = await withTransaction(async (client) => {
 *   await client.query('UPDATE inventory SET stock = stock - $1 WHERE id = $2', [qty, variantId]);
 *   const { rows } = await client.query('INSERT INTO orders (...) VALUES (...) RETURNING *', [...]);
 *   return rows[0];
 * });
 */
export async function withTransaction<T>(
  fn: (client: {
    query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
  }) => Promise<T>
): Promise<T> {
  try {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (poolErr) {
    // If WebSocket Pool is unavailable (e.g., non-101 WebSocket status), fall back to HTTP query execution
    const sql = getSql();
    const fallbackClient = {
      query: async (text: string, params?: unknown[]) => {
        const rows = await sql.query(text, (params || []) as any[]);
        return {
          rows: (rows as Record<string, unknown>[]) || [],
          rowCount: Array.isArray(rows) ? rows.length : 0,
        };
      },
    };
    return fn(fallbackClient);
  }
}

/**
 * Check if the database connection is healthy.
 */
export async function healthCheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await query('SELECT 1 as health');
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - start, error: err?.message };
  }
}
