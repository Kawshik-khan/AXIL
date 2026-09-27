/**
 * CommerceOS — User & IAM Repository
 * Authoritative data access for users, memberships, invitations, and audit logs.
 * Backed by Neon PostgreSQL with fallback support.
 */

import { GlobalRepository } from '@/infrastructure/db/base-repository';
import { query, queryOne, execute } from '@/infrastructure/neon/client';
import { db, UserRecord, MembershipRecord, InvitationRecord, AuditLogRecord } from '@/infrastructure/db';
import { RoleName } from '@/lib/permissions';

export class UserRepository extends GlobalRepository<UserRecord> {
  constructor() {
    super('users', 'id');
  }

  private isNeonConfigured(): boolean {
    return Boolean(process.env.DATABASE_URL);
  }

  async findById(id: string): Promise<UserRecord | null> {
    if (!this.isNeonConfigured()) {
      return db.findUserById(id) || null;
    }
    return super.findById(id);
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    if (!this.isNeonConfigured()) {
      return db.findUserByEmail(email) || null;
    }
    const normalized = email.trim().toLowerCase();
    return queryOne<UserRecord>(
      `SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [normalized]
    );
  }

  async createUser(user: UserRecord): Promise<UserRecord> {
    if (!this.isNeonConfigured()) {
      return db.createUser(user);
    }
    const created = await this.create(user);
    db.createUser(user);
    return created;
  }

  async updateUser(id: string, updates: Partial<UserRecord>): Promise<UserRecord | null> {
    if (!this.isNeonConfigured()) {
      return db.updateUser(id, updates) || null;
    }
    const updated = await this.update(id, updates);
    if (updated) {
      db.updateUser(id, updates);
    }
    return updated;
  }

  // ── Memberships ──────────────────────────────────────────────

  async findMembership(tenantId: string, userId: string): Promise<MembershipRecord | null> {
    if (!this.isNeonConfigured()) {
      return db.findMembership(tenantId, userId) || null;
    }
    return queryOne<MembershipRecord>(
      `SELECT * FROM memberships WHERE tenant_id = $1 AND user_id = $2 LIMIT 1`,
      [tenantId, userId]
    );
  }

  async findMembershipsByTenantId(tenantId: string): Promise<MembershipRecord[]> {
    if (!this.isNeonConfigured()) {
      return db.findMembershipsByTenantId(tenantId);
    }
    return query<MembershipRecord>(
      `SELECT * FROM memberships WHERE tenant_id = $1 ORDER BY created_at ASC`,
      [tenantId]
    );
  }

  async findMembershipsByUserId(userId: string): Promise<MembershipRecord[]> {
    if (!this.isNeonConfigured()) {
      return db.findMembershipsByUserId(userId);
    }
    return query<MembershipRecord>(
      `SELECT * FROM memberships WHERE user_id = $1 ORDER BY created_at ASC`,
      [userId]
    );
  }

  async createMembership(membership: MembershipRecord): Promise<MembershipRecord> {
    if (!this.isNeonConfigured()) {
      return db.createMembership(membership);
    }
    const rows = await query<MembershipRecord>(
      `INSERT INTO memberships (id, tenant_id, user_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [
        membership.id,
        membership.tenant_id,
        membership.user_id,
        membership.role,
        membership.created_at || new Date().toISOString(),
        membership.updated_at || new Date().toISOString(),
      ]
    );
    db.createMembership(membership);
    return rows[0] || membership;
  }

  async updateMembershipRole(tenantId: string, userId: string, role: RoleName): Promise<MembershipRecord | null> {
    if (!this.isNeonConfigured()) {
      return db.updateMembershipRole(tenantId, userId, role) || null;
    }
    const now = new Date().toISOString();
    const rows = await query<MembershipRecord>(
      `UPDATE memberships SET role = $1, updated_at = $2 WHERE tenant_id = $3 AND user_id = $4 RETURNING *`,
      [role, now, tenantId, userId]
    );
    if (rows[0]) {
      db.updateMembershipRole(tenantId, userId, role);
    }
    return rows[0] || null;
  }

  async removeMembership(tenantId: string, userId: string): Promise<boolean> {
    if (!this.isNeonConfigured()) {
      return db.removeMembership(tenantId, userId);
    }
    const result = await execute(
      `DELETE FROM memberships WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, userId]
    );
    db.removeMembership(tenantId, userId);
    return result.rowCount > 0;
  }

  // ── Invitations ──────────────────────────────────────────────

  async createInvitation(invitation: InvitationRecord): Promise<InvitationRecord> {
    if (!this.isNeonConfigured()) {
      return db.createInvitation(invitation);
    }
    const rows = await query<InvitationRecord>(
      `INSERT INTO invitations (id, tenant_id, email, role, token, status, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        invitation.id,
        invitation.tenant_id,
        invitation.email,
        invitation.role,
        invitation.token,
        invitation.status,
        invitation.expires_at,
        invitation.created_at || new Date().toISOString(),
      ]
    );
    db.createInvitation(invitation);
    return rows[0] || invitation;
  }

  async findInvitationByToken(token: string): Promise<InvitationRecord | null> {
    if (!this.isNeonConfigured()) {
      return db.findInvitationByToken(token) || null;
    }
    return queryOne<InvitationRecord>(
      `SELECT * FROM invitations WHERE token = $1 LIMIT 1`,
      [token]
    );
  }

  async updateInvitation(id: string, patch: Partial<InvitationRecord>): Promise<InvitationRecord | null> {
    if (!this.isNeonConfigured()) {
      return db.updateInvitation(id, patch) || null;
    }
    const sets = Object.keys(patch).map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = Object.values(patch);
    const rows = await query<InvitationRecord>(
      `UPDATE invitations SET ${sets} WHERE id = $1 RETURNING *`,
      [id, ...values]
    );
    if (rows[0]) {
      db.updateInvitation(id, patch);
    }
    return rows[0] || null;
  }

  // ── Audit Logs ───────────────────────────────────────────────

  async createAuditLog(log: AuditLogRecord): Promise<AuditLogRecord> {
    if (!this.isNeonConfigured()) {
      return db.createAuditLog(log);
    }
    const rows = await query<AuditLogRecord>(
      `INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata, ip_address, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        log.id,
        log.tenant_id,
        log.actor_user_id,
        log.action,
        log.resource_type,
        log.resource_id,
        JSON.stringify(log.metadata || {}),
        log.ip_address || null,
        log.user_agent || null,
        log.created_at || new Date().toISOString(),
      ]
    );
    db.createAuditLog(log);
    return rows[0] || log;
  }

  async findAuditLogs(tenantId: string, limit: number = 50): Promise<AuditLogRecord[]> {
    if (!this.isNeonConfigured()) {
      return db.findAuditLogs(tenantId, limit);
    }
    return query<AuditLogRecord>(
      `SELECT * FROM audit_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [tenantId, limit]
    );
  }
}

export const userRepository = new UserRepository();
