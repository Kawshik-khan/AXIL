/**
 * CommerceOS — Automation Repository
 * Workflows, automation executions, and dead-letter queues via Neon PostgreSQL.
 * Backed by Neon PostgreSQL with fallback support.
 */

import { BaseRepository } from '@/infrastructure/db/base-repository';
import { query, queryOne, execute } from '@/infrastructure/neon/client';
import { db } from '@/infrastructure/db';

export interface AutomationRecord {
  id: string;
  tenant_id: string;
  name: string;
  trigger_event: string;
  condition_rules?: Record<string, unknown>;
  action_type: string;
  action_config?: Record<string, unknown>;
  is_active: boolean;
  run_count?: number;
  last_run_at?: string;
  created_at: string;
  updated_at: string;
}

export class AutomationRepository extends BaseRepository<AutomationRecord & Record<string, unknown>> {
  constructor() {
    super('automations', 'id');
  }

  private isNeonConfigured(): boolean {
    return Boolean(process.env.DATABASE_URL);
  }

  async listAutomations(tenantId: string): Promise<AutomationRecord[]> {
    if (!this.isNeonConfigured()) {
      return (db.data.automations || []).filter((a: any) => a.tenant_id === tenantId) as unknown as AutomationRecord[];
    }
    return query<AutomationRecord>(
      `SELECT * FROM automations WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId]
    );
  }

  async createAutomation(item: AutomationRecord): Promise<AutomationRecord> {
    db.markDirty(); // persists direct changes to db.data (FX-20)
    if (!this.isNeonConfigured()) {
      if (!db.data.automations) db.data.automations = [];
      db.data.automations.push(item as any);
      db.markDirty();
      return item;
    }

    const created = await queryOne<AutomationRecord>(
      `INSERT INTO automations (
        id, tenant_id, name, trigger_event, condition_rules,
        action_type, action_config, is_active, run_count, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        item.id,
        item.tenant_id,
        item.name,
        item.trigger_event,
        JSON.stringify(item.condition_rules || {}),
        item.action_type,
        JSON.stringify(item.action_config || {}),
        item.is_active,
        item.run_count || 0,
        item.created_at || new Date().toISOString(),
        item.updated_at || new Date().toISOString(),
      ]
    );

    db.markDirty();
    return created || item;
  }
}

export const automationRepository = new AutomationRepository();
