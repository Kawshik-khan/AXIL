/**
 * CommerceOS — Base Repository
 * Generic repository providing tenant-scoped CRUD operations via Neon PostgreSQL.
 * 
 * All domain repositories extend this base to inherit:
 * - Mandatory tenant_id isolation on every query
 * - Parameterized SQL to prevent injection
 * - Consistent error handling
 * - Pagination support
 */

import { query, queryOne, execute } from '@/infrastructure/neon/client';

export interface PaginationOptions {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export interface WhereClause {
  field: string;
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'ILIKE' | 'IN' | 'IS NULL' | 'IS NOT NULL';
  value?: unknown;
}

export abstract class BaseRepository<T = any> {
  constructor(
    protected readonly tableName: string,
    protected readonly primaryKey: string = 'id'
  ) {}

  /**
   * Find a single record by ID within a tenant.
   */
  async findById(tenantId: string, id: string): Promise<T | null> {
    return queryOne<T>(
      `SELECT * FROM ${this.tableName} WHERE tenant_id = $1 AND ${this.primaryKey} = $2 LIMIT 1`,
      [tenantId, id]
    );
  }

  /**
   * Find many records with optional filters and pagination.
   */
  async findMany(
    tenantId: string,
    options: PaginationOptions = {},
    wheres: WhereClause[] = []
  ): Promise<PaginatedResult<T>> {
    const { page = 1, limit = 50, sortBy = 'created_at', sortOrder = 'DESC' } = options;
    const offset = (page - 1) * limit;

    // Build WHERE clause
    let whereSQL = `tenant_id = $1`;
    const params: unknown[] = [tenantId];
    let paramIdx = 2;

    for (const w of wheres) {
      if (w.operator === 'IS NULL') {
        whereSQL += ` AND ${w.field} IS NULL`;
      } else if (w.operator === 'IS NOT NULL') {
        whereSQL += ` AND ${w.field} IS NOT NULL`;
      } else if (w.operator === 'IN' && Array.isArray(w.value)) {
        const placeholders = w.value.map((_, i) => `$${paramIdx + i}`).join(', ');
        whereSQL += ` AND ${w.field} IN (${placeholders})`;
        params.push(...w.value);
        paramIdx += w.value.length;
      } else {
        whereSQL += ` AND ${w.field} ${w.operator} $${paramIdx}`;
        params.push(w.value);
        paramIdx++;
      }
    }

    // Whitelist sort columns to prevent SQL injection
    const safeSortBy = /^[a-zA-Z_]+$/.test(sortBy) ? sortBy : 'created_at';
    const safeSortOrder = sortOrder === 'ASC' ? 'ASC' : 'DESC';

    // Count total
    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM ${this.tableName} WHERE ${whereSQL}`,
      params
    );
    const total = parseInt(countResult[0]?.count || '0', 10);

    // Fetch data
    const data = await query<T>(
      `SELECT * FROM ${this.tableName} WHERE ${whereSQL} ORDER BY ${safeSortBy} ${safeSortOrder} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find all records matching criteria (no pagination).
   */
  async findAll(
    tenantId: string,
    wheres: WhereClause[] = [],
    sortBy: string = 'created_at',
    sortOrder: 'ASC' | 'DESC' = 'DESC'
  ): Promise<T[]> {
    let whereSQL = `tenant_id = $1`;
    const params: unknown[] = [tenantId];
    let paramIdx = 2;

    for (const w of wheres) {
      if (w.operator === 'IS NULL') {
        whereSQL += ` AND ${w.field} IS NULL`;
      } else if (w.operator === 'IS NOT NULL') {
        whereSQL += ` AND ${w.field} IS NOT NULL`;
      } else {
        whereSQL += ` AND ${w.field} ${w.operator} $${paramIdx}`;
        params.push(w.value);
        paramIdx++;
      }
    }

    const safeSortBy = /^[a-zA-Z_]+$/.test(sortBy) ? sortBy : 'created_at';
    const safeSortOrder = sortOrder === 'ASC' ? 'ASC' : 'DESC';

    return query<T>(
      `SELECT * FROM ${this.tableName} WHERE ${whereSQL} ORDER BY ${safeSortBy} ${safeSortOrder}`,
      params
    );
  }

  /**
   * Insert a new record. Returns the inserted record.
   */
  async create(record: Partial<T> & { tenant_id?: string }): Promise<T> {
    const rec = record as Record<string, any>;
    const keys = Object.keys(rec).filter((k) => rec[k] !== undefined);
    const values = keys.map((k) => rec[k]);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const columns = keys.join(', ');

    const result = await query<T>(
      `INSERT INTO ${this.tableName} (${columns}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    return result[0];
  }

  /**
   * Update a record by ID within a tenant.
   */
  async update(tenantId: string, id: string, patch: Partial<T>): Promise<T | null> {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return this.findById(tenantId, id);

    // Add updated_at if the table has it
    const hasUpdatedAt = entries.some(([k]) => k === 'updated_at');
    if (!hasUpdatedAt) {
      entries.push(['updated_at', new Date().toISOString()]);
    }

    const setClauses = entries.map(([key], i) => `${key} = $${i + 3}`).join(', ');
    const values = entries.map(([, val]) => val);

    const result = await query<T>(
      `UPDATE ${this.tableName} SET ${setClauses} WHERE tenant_id = $1 AND ${this.primaryKey} = $2 RETURNING *`,
      [tenantId, id, ...values]
    );
    return result[0] || null;
  }

  /**
   * Delete a record by ID within a tenant.
   */
  async delete(tenantId: string, id: string): Promise<boolean> {
    const result = await query(
      `DELETE FROM ${this.tableName} WHERE tenant_id = $1 AND ${this.primaryKey} = $2 RETURNING ${this.primaryKey}`,
      [tenantId, id]
    );
    return result.length > 0;
  }

  /**
   * Count records matching criteria.
   */
  async count(tenantId: string, wheres: WhereClause[] = []): Promise<number> {
    let whereSQL = `tenant_id = $1`;
    const params: unknown[] = [tenantId];
    let paramIdx = 2;

    for (const w of wheres) {
      if (w.operator === 'IS NULL') {
        whereSQL += ` AND ${w.field} IS NULL`;
      } else {
        whereSQL += ` AND ${w.field} ${w.operator} $${paramIdx}`;
        params.push(w.value);
        paramIdx++;
      }
    }

    const result = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM ${this.tableName} WHERE ${whereSQL}`,
      params
    );
    return parseInt(result[0]?.count || '0', 10);
  }

  /**
   * Check if a record exists.
   */
  async exists(tenantId: string, id: string): Promise<boolean> {
    const result = await queryOne<{ id: string }>(
      `SELECT ${this.primaryKey} FROM ${this.tableName} WHERE tenant_id = $1 AND ${this.primaryKey} = $2 LIMIT 1`,
      [tenantId, id]
    );
    return result !== null;
  }
}

/**
 * Base repository for tables WITHOUT tenant_id (e.g., users, tenants themselves).
 */
export abstract class GlobalRepository<T = any> {
  constructor(
    protected readonly tableName: string,
    protected readonly primaryKey: string = 'id'
  ) {}

  async findById(id: string): Promise<T | null> {
    return queryOne<T>(
      `SELECT * FROM ${this.tableName} WHERE ${this.primaryKey} = $1 LIMIT 1`,
      [id]
    );
  }

  async create(record: Partial<T>): Promise<T> {
    const rec = record as Record<string, any>;
    const keys = Object.keys(rec).filter((k) => rec[k] !== undefined);
    const values = keys.map((k) => rec[k]);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const columns = keys.join(', ');

    const result = await query<T>(
      `INSERT INTO ${this.tableName} (${columns}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    return result[0];
  }

  async update(id: string, patch: Partial<T>): Promise<T | null> {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return this.findById(id);

    const hasUpdatedAt = entries.some(([k]) => k === 'updated_at');
    if (!hasUpdatedAt) {
      entries.push(['updated_at', new Date().toISOString()]);
    }

    const setClauses = entries.map(([key], i) => `${key} = $${i + 2}`).join(', ');
    const values = entries.map(([, val]) => val);

    const result = await query<T>(
      `UPDATE ${this.tableName} SET ${setClauses} WHERE ${this.primaryKey} = $1 RETURNING *`,
      [id, ...values]
    );
    return result[0] || null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await query(
      `DELETE FROM ${this.tableName} WHERE ${this.primaryKey} = $1 RETURNING ${this.primaryKey}`,
      [id]
    );
    return result.length > 0;
  }
}
