import crypto from "crypto";
import { db, ServiceTokenRecord } from "@/infrastructure/db";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { AuditService } from "@/domains/audit/service";
import { Permission, PERMISSIONS, SERVICE_TOKEN_SCOPES } from "@/lib/permissions";
import { AuthenticationError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId } from "@/lib/ids";

export const SERVICE_TOKEN_PREFIX = "cos_svc_";

const sha256 = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

export type ServiceTokenView = Omit<ServiceTokenRecord, "key_hash">;

const view = ({ key_hash: _hash, ...rest }: ServiceTokenRecord): ServiceTokenView => rest;

/**
 * Machine credentials for automation callers such as n8n (FIX_IMPLEMENTATION_PLAN FX-18).
 * A token is `cos_svc_` + 32 random bytes (base64url), shown once. Only its SHA-256 hash is stored. A token acts in its
 * workspace with exactly its scopes, which are limited to SERVICE_TOKEN_SCOPES and to what its creator holds.
 */
export class ServiceTokenService {
  public static list(context: RequestContext): ServiceTokenView[] {
    RbacService.assertCan(context, PERMISSIONS.SERVICE_TOKENS_MANAGE);
    return db.getServiceTokens(context.tenant.id).map(view);
  }

  public static create(
    context: RequestContext,
    input: { name: string; scopes: string[]; expires_in_days?: number }
  ): { token: string; service_token: ServiceTokenView } {
    RbacService.assertCan(context, PERMISSIONS.SERVICE_TOKENS_MANAGE);
    const scopes = Array.from(new Set(input.scopes)) as Permission[];
    if (scopes.length === 0) {
      throw new ValidationError("Choose at least one scope.");
    }
    const notAllowed = scopes.filter((s) => !SERVICE_TOKEN_SCOPES.includes(s));
    if (notAllowed.length > 0) {
      throw new ValidationError("Some scopes can't be given to a service token.", { scopes: notAllowed });
    }
    const notHeld = scopes.filter((s) => !context.permissions.includes(s));
    if (notHeld.length > 0) {
      throw new ForbiddenError(`You can only grant scopes you hold yourself: ${notHeld.join(", ")}.`);
    }

    const token = `${SERVICE_TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
    const now = new Date();
    const record = db.createServiceToken({
      id: newId("svc"),
      tenant_id: context.tenant.id,
      name: input.name,
      key_prefix: token.slice(0, SERVICE_TOKEN_PREFIX.length + 6),
      key_hash: sha256(token),
      scopes,
      created_by: context.user.id,
      created_at: now.toISOString(),
      ...(input.expires_in_days ? { expires_at: new Date(now.getTime() + input.expires_in_days * 86_400_000).toISOString() } : {}),
    });
    AuditService.log({
      tenantId: context.tenant.id,
      actorUserId: context.user.id,
      action: "SERVICE_TOKEN_CREATED",
      resourceType: "service_token",
      resourceId: record.id,
      metadata: { name: record.name, scopes, expires_at: record.expires_at },
    });
    return { token, service_token: view(record) };
  }

  public static revoke(context: RequestContext, id: string): ServiceTokenView {
    RbacService.assertCan(context, PERMISSIONS.SERVICE_TOKENS_MANAGE);
    const updated = db.updateServiceToken(context.tenant.id, id, { revoked_at: new Date().toISOString() });
    if (!updated) throw new NotFoundError("Service token", id);
    AuditService.log({
      tenantId: context.tenant.id,
      actorUserId: context.user.id,
      action: "SERVICE_TOKEN_REVOKED",
      resourceType: "service_token",
      resourceId: id,
      metadata: {},
    });
    return view(updated);
  }

  /** Builds the request context for a presented service token, or throws 401. */
  public static resolveContext(token: string, requestId: string): RequestContext {
    const record = db.findServiceTokenByHash(sha256(token));
    const now = Date.now();
    if (!record || record.revoked_at || (record.expires_at && Date.parse(record.expires_at) <= now)) {
      throw new AuthenticationError("Service token is invalid, expired or revoked.");
    }
    const tenant = db.findTenantById(record.tenant_id);
    if (!tenant) {
      throw new AuthenticationError("Service token workspace no longer exists.");
    }
    db.updateServiceToken(record.tenant_id, record.id, { last_used_at: new Date(now).toISOString() });
    return {
      requestId,
      traceId: `trc_svc_${requestId}`,
      user: { id: record.id, email: `service-token:${record.key_prefix}`, name: `Service token: ${record.name}`, status: "ACTIVE" },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        currency: tenant.currency,
        timezone: tenant.timezone,
        language: tenant.language,
        status: tenant.status,
      },
      role: "SERVICE",
      // Only scopes that are still allowed for service tokens take effect.
      permissions: record.scopes.filter((s): s is Permission => SERVICE_TOKEN_SCOPES.includes(s as Permission)),
      timestamp: new Date(now).toISOString(),
    };
  }
}
