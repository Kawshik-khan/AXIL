/**
 * CommerceOS — Tenant Repository
 * Authoritative data access for tenants via Neon PostgreSQL.
 * Fallback to in-memory db if DATABASE_URL is not set.
 */

import { GlobalRepository } from '@/infrastructure/db/base-repository';
import { query, queryOne } from '@/infrastructure/neon/client';
import { db, TenantRecord } from '@/infrastructure/db';

export class TenantRepository extends GlobalRepository<TenantRecord> {
  constructor() {
    super('tenants', 'id');
  }

  private isNeonConfigured(): boolean {
    return Boolean(process.env.DATABASE_URL);
  }

  async findById(id: string): Promise<TenantRecord | null> {
    if (!this.isNeonConfigured()) {
      return db.findTenantById(id) || null;
    }
    return super.findById(id);
  }

  async findBySlug(slug: string): Promise<TenantRecord | null> {
    if (!this.isNeonConfigured()) {
      return db.findTenantBySlug(slug) || null;
    }
    return queryOne<TenantRecord>(
      `SELECT * FROM tenants WHERE slug = $1 LIMIT 1`,
      [slug]
    );
  }

  async createTenant(tenant: TenantRecord): Promise<TenantRecord> {
    if (!this.isNeonConfigured()) {
      return db.createTenant(tenant);
    }
    const created = await this.create(tenant);
    // Keep in-memory cache in sync
    db.createTenant(tenant);
    return created;
  }

  async updateTenant(id: string, patch: Partial<TenantRecord>): Promise<TenantRecord | null> {
    if (!this.isNeonConfigured()) {
      return db.updateTenant(id, patch) || null;
    }
    const updated = await this.update(id, patch);
    if (updated) {
      db.updateTenant(id, patch);
    }
    return updated;
  }

  async listAll(): Promise<TenantRecord[]> {
    if (!this.isNeonConfigured()) {
      return db.data.tenants;
    }
    return query<TenantRecord>(`SELECT * FROM tenants ORDER BY created_at DESC`);
  }
}

export const tenantRepository = new TenantRepository();
