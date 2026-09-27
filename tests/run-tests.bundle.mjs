// tests/run-tests.ts
import assert from "assert";

// src/infrastructure/db/index.ts
import fs from "fs";
import path from "path";
var CommerceDatabase = class {
  data;
  filePath;
  isPersisting = false;
  constructor() {
    const dataDir = path.join(process.cwd(), ".data");
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch {
      }
    }
    this.filePath = path.join(dataDir, "commerceos.json");
    this.data = this.loadData();
    this.ensureDefaultSeed();
  }
  loadData() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        return JSON.parse(raw);
      }
    } catch {
    }
    return {
      tenants: [],
      users: [],
      memberships: [],
      invitations: [],
      audit_logs: []
    };
  }
  persist() {
    if (this.isPersisting) return;
    this.isPersisting = true;
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
    } catch {
    } finally {
      this.isPersisting = false;
    }
  }
  ensureDefaultSeed() {
    if (this.data.tenants.length === 0) {
      const tenantId = "ten_default_dhaka";
      const userId = "usr_owner_default";
      const defaultTenant = {
        id: tenantId,
        name: "Dhaka D2C Apparel",
        slug: "dhaka-d2c-apparel",
        currency: "BDT",
        timezone: "Asia/Dhaka",
        language: "en",
        settings: {
          delivery_charge_inside_dhaka: 60,
          delivery_charge_outside_dhaka: 120,
          cod_advance_required: false,
          business_category: "Fashion & Apparel"
        },
        status: "ACTIVE",
        created_at: (/* @__PURE__ */ new Date()).toISOString(),
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      const defaultUser = {
        id: userId,
        email: "admin@commerceos.io",
        name: "Rafiqul Islam",
        avatar: "",
        password_hash: "$2a$10$iM.oG9E/T0.1h3lP2kQeeeh7sU988wL2v/51Z2qK1vW8kK8E7v.yG",
        status: "ACTIVE",
        created_at: (/* @__PURE__ */ new Date()).toISOString(),
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      const defaultMembership = {
        id: "mem_default_owner",
        tenant_id: tenantId,
        user_id: userId,
        role: "OWNER",
        created_at: (/* @__PURE__ */ new Date()).toISOString(),
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      const defaultAudit = {
        id: "aud_seed_001",
        tenant_id: tenantId,
        actor_user_id: userId,
        action: "TENANT_INITIALIZED",
        resource_type: "tenant",
        resource_id: tenantId,
        metadata: { reason: "Initial workspace seed creation" },
        created_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      this.data.tenants.push(defaultTenant);
      this.data.users.push(defaultUser);
      this.data.memberships.push(defaultMembership);
      this.data.audit_logs.push(defaultAudit);
      this.persist();
    }
  }
  // ==================== TENANTS ====================
  getTenants() {
    return [...this.data.tenants];
  }
  findTenantById(id) {
    return this.data.tenants.find((t) => t.id === id);
  }
  findTenantBySlug(slug) {
    return this.data.tenants.find((t) => t.slug === slug);
  }
  createTenant(tenant) {
    this.data.tenants.push(tenant);
    this.persist();
    return tenant;
  }
  updateTenant(id, updates) {
    const idx = this.data.tenants.findIndex((t) => t.id === id);
    if (idx === -1) return void 0;
    this.data.tenants[idx] = {
      ...this.data.tenants[idx],
      ...updates,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.persist();
    return this.data.tenants[idx];
  }
  // ==================== USERS ====================
  findUserById(id) {
    return this.data.users.find((u) => u.id === id);
  }
  findUserByEmail(email) {
    const normalized = email.trim().toLowerCase();
    return this.data.users.find((u) => u.email.toLowerCase() === normalized);
  }
  createUser(user) {
    this.data.users.push(user);
    this.persist();
    return user;
  }
  updateUser(id, updates) {
    const idx = this.data.users.findIndex((u) => u.id === id);
    if (idx === -1) return void 0;
    this.data.users[idx] = {
      ...this.data.users[idx],
      ...updates,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.persist();
    return this.data.users[idx];
  }
  // ==================== MEMBERSHIPS (TENANT-SCOPED) ====================
  findMembershipsByUserId(userId) {
    return this.data.memberships.filter((m) => m.user_id === userId);
  }
  findMembershipsByTenantId(tenantId) {
    return this.data.memberships.filter((m) => m.tenant_id === tenantId);
  }
  findMembership(tenantId, userId) {
    return this.data.memberships.find((m) => m.tenant_id === tenantId && m.user_id === userId);
  }
  createMembership(membership) {
    this.data.memberships.push(membership);
    this.persist();
    return membership;
  }
  updateMembershipRole(tenantId, userId, role) {
    const idx = this.data.memberships.findIndex((m) => m.tenant_id === tenantId && m.user_id === userId);
    if (idx === -1) return void 0;
    this.data.memberships[idx].role = role;
    this.data.memberships[idx].updated_at = (/* @__PURE__ */ new Date()).toISOString();
    this.persist();
    return this.data.memberships[idx];
  }
  removeMembership(tenantId, userId) {
    const initialLen = this.data.memberships.length;
    this.data.memberships = this.data.memberships.filter((m) => !(m.tenant_id === tenantId && m.user_id === userId));
    const removed = this.data.memberships.length < initialLen;
    if (removed) this.persist();
    return removed;
  }
  // ==================== INVITATIONS (TENANT-SCOPED) ====================
  createInvitation(invitation) {
    this.data.invitations.push(invitation);
    this.persist();
    return invitation;
  }
  findInvitationByToken(token) {
    return this.data.invitations.find((i) => i.token === token);
  }
  findInvitationsByTenant(tenantId) {
    return this.data.invitations.filter((i) => i.tenant_id === tenantId);
  }
  updateInvitationStatus(token, status) {
    const idx = this.data.invitations.findIndex((i) => i.token === token);
    if (idx === -1) return void 0;
    this.data.invitations[idx].status = status;
    this.persist();
    return this.data.invitations[idx];
  }
  // ==================== AUDIT LOGS (IMMUTABLE, APPEND-ONLY) ====================
  createAuditLog(log) {
    this.data.audit_logs.push(log);
    this.persist();
    return log;
  }
  getAuditLogsByTenant(tenantId, limit = 50, offset = 0) {
    const filtered = this.data.audit_logs.filter((l) => l.tenant_id === tenantId).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return {
      logs: filtered.slice(offset, offset + limit),
      total: filtered.length
    };
  }
  // For testing resets
  clearAllForTesting() {
    this.data = {
      tenants: [],
      users: [],
      memberships: [],
      invitations: [],
      audit_logs: []
    };
    this.ensureDefaultSeed();
  }
};
var db = new CommerceDatabase();

// src/lib/security.ts
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
var JWT_SECRET = process.env.JWT_SECRET || "commerceos_super_secret_jwt_key_min_32_characters_for_security_2026";
var key = new TextEncoder().encode(JWT_SECRET);
async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}
async function signSessionToken(payload) {
  return new SignJWT({ ...payload }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(key);
}
async function verifySessionToken(token) {
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"]
    });
    return {
      userId: payload.userId,
      tenantId: payload.tenantId,
      role: payload.role,
      email: payload.email,
      name: payload.name
    };
  } catch {
    return null;
  }
}
function generateSecureToken(length = 32) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < length; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// src/lib/errors.ts
var AppError = class extends Error {
  code;
  statusCode;
  details;
  constructor(code, message, statusCode = 400, details) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
};
var AuthenticationError = class extends AppError {
  constructor(message = "Authentication required or credentials invalid.", details) {
    super("AUTHENTICATION_FAILED", message, 401, details);
  }
};
var ForbiddenError = class extends AppError {
  constructor(message = "You do not possess the required permission for this operation.", details) {
    super("FORBIDDEN", message, 403, details);
  }
};
var NotFoundError = class extends AppError {
  constructor(resource, identifier) {
    const msg = identifier ? `${resource} '${identifier}' was not found.` : `${resource} was not found.`;
    super("NOT_FOUND", msg, 404, { resource, identifier });
  }
};
var ConflictError = class extends AppError {
  constructor(message, details) {
    super("CONFLICT", message, 409, details);
  }
};
var ValidationError = class extends AppError {
  constructor(message, details) {
    super("VALIDATION_ERROR", message, 400, details);
  }
};
var TenantSuspendedError = class extends AppError {
  constructor(tenantName) {
    super("TENANT_SUSPENDED", `Workspace ${tenantName || ""} is currently suspended. Please contact support.`, 403);
  }
};
var UserSuspendedError = class extends AppError {
  constructor() {
    super("USER_SUSPENDED", "Your user account is currently suspended or deactivated.", 403);
  }
};

// src/lib/permissions.ts
var PERMISSIONS = {
  // Workspace / Tenant
  WORKSPACE_READ: "workspace.read",
  WORKSPACE_UPDATE: "workspace.update",
  WORKSPACE_DELETE: "workspace.delete",
  // User Management
  USER_READ: "user.read",
  USER_INVITE: "user.invite",
  USER_UPDATE: "user.update",
  USER_REMOVE: "user.remove",
  // Roles & Access Control
  ROLE_READ: "role.read",
  ROLE_MANAGE: "role.manage",
  // Workspace Settings
  SETTINGS_READ: "settings.read",
  SETTINGS_UPDATE: "settings.update",
  // Security & Audit
  AUDIT_READ: "audit.read",
  // Dashboard & Control Plane
  DASHBOARD_READ: "dashboard.read",
  // Future Domain Scopes (Readiness for Phase 2+)
  PRODUCTS_READ: "products.read",
  PRODUCTS_WRITE: "products.write",
  INVENTORY_READ: "inventory.read",
  INVENTORY_WRITE: "inventory.write",
  ORDERS_READ: "orders.read",
  ORDERS_WRITE: "orders.write",
  PAYMENTS_READ: "payments.read",
  PAYMENTS_REFUND: "payments.refund",
  FINANCE_READ: "finance.read",
  ANALYTICS_READ: "analytics.read",
  MARKETING_READ: "marketing.read",
  MARKETING_WRITE: "marketing.write",
  SUPPORT_READ: "support.read",
  SUPPORT_WRITE: "support.write",
  AGENT_RUN: "agent.run",
  AGENT_CONFIGURE: "agent.configure"
};
var ROLE_PERMISSIONS = {
  OWNER: Object.values(PERMISSIONS),
  // Owner has all permissions
  ADMIN: [
    PERMISSIONS.WORKSPACE_READ,
    PERMISSIONS.WORKSPACE_UPDATE,
    PERMISSIONS.USER_READ,
    PERMISSIONS.USER_INVITE,
    PERMISSIONS.USER_UPDATE,
    PERMISSIONS.USER_REMOVE,
    PERMISSIONS.ROLE_READ,
    PERMISSIONS.ROLE_MANAGE,
    PERMISSIONS.SETTINGS_READ,
    PERMISSIONS.SETTINGS_UPDATE,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.PRODUCTS_READ,
    PERMISSIONS.PRODUCTS_WRITE,
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.INVENTORY_WRITE,
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.ORDERS_WRITE,
    PERMISSIONS.PAYMENTS_READ,
    PERMISSIONS.FINANCE_READ,
    PERMISSIONS.ANALYTICS_READ,
    PERMISSIONS.MARKETING_READ,
    PERMISSIONS.MARKETING_WRITE,
    PERMISSIONS.SUPPORT_READ,
    PERMISSIONS.SUPPORT_WRITE,
    PERMISSIONS.AGENT_RUN,
    PERMISSIONS.AGENT_CONFIGURE
  ],
  MANAGER: [
    PERMISSIONS.WORKSPACE_READ,
    PERMISSIONS.USER_READ,
    PERMISSIONS.SETTINGS_READ,
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.PRODUCTS_READ,
    PERMISSIONS.PRODUCTS_WRITE,
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.INVENTORY_WRITE,
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.ORDERS_WRITE,
    PERMISSIONS.PAYMENTS_READ,
    PERMISSIONS.ANALYTICS_READ,
    PERMISSIONS.SUPPORT_READ,
    PERMISSIONS.SUPPORT_WRITE,
    PERMISSIONS.AGENT_RUN
  ],
  SALES: [
    PERMISSIONS.WORKSPACE_READ,
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.PRODUCTS_READ,
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.ORDERS_WRITE,
    PERMISSIONS.SUPPORT_READ,
    PERMISSIONS.SUPPORT_WRITE,
    PERMISSIONS.AGENT_RUN
  ],
  SUPPORT: [
    PERMISSIONS.WORKSPACE_READ,
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.PRODUCTS_READ,
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.SUPPORT_READ,
    PERMISSIONS.SUPPORT_WRITE,
    PERMISSIONS.AGENT_RUN
  ],
  MARKETING: [
    PERMISSIONS.WORKSPACE_READ,
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.PRODUCTS_READ,
    PERMISSIONS.ANALYTICS_READ,
    PERMISSIONS.MARKETING_READ,
    PERMISSIONS.MARKETING_WRITE,
    PERMISSIONS.AGENT_RUN
  ],
  INVENTORY: [
    PERMISSIONS.WORKSPACE_READ,
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.PRODUCTS_READ,
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.INVENTORY_WRITE,
    PERMISSIONS.AGENT_RUN
  ],
  FINANCE: [
    PERMISSIONS.WORKSPACE_READ,
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.PAYMENTS_READ,
    PERMISSIONS.PAYMENTS_REFUND,
    PERMISSIONS.FINANCE_READ,
    PERMISSIONS.ANALYTICS_READ,
    PERMISSIONS.AUDIT_READ
  ],
  ANALYST: [
    PERMISSIONS.WORKSPACE_READ,
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.PRODUCTS_READ,
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.FINANCE_READ,
    PERMISSIONS.ANALYTICS_READ
  ]
};

// src/lib/context.ts
function hasPermission(context, permission) {
  if (context.user.status !== "ACTIVE") {
    return false;
  }
  if (context.tenant.status !== "ACTIVE") {
    return false;
  }
  return context.permissions.includes(permission);
}

// src/domains/rbac/service.ts
var RbacService = class {
  static getPermissionsForRole(role) {
    return ROLE_PERMISSIONS[role] || [];
  }
  static can(context, permission) {
    return hasPermission(context, permission);
  }
  static assertCan(context, permission) {
    if (context.user.status !== "ACTIVE") {
      throw new UserSuspendedError();
    }
    if (context.tenant.status !== "ACTIVE") {
      throw new TenantSuspendedError(context.tenant.name);
    }
    if (!context.permissions.includes(permission)) {
      throw new ForbiddenError(
        `Action requires permission '${permission}', but role '${context.role}' does not grant it.`
      );
    }
  }
};

// src/domains/audit/service.ts
var AuditService = class {
  static log(input) {
    const id = `aud_${Math.random().toString(36).substring(2, 10)}`;
    const logRecord = {
      id,
      tenant_id: input.tenantId,
      actor_user_id: input.actorUserId,
      action: input.action,
      resource_type: input.resourceType,
      resource_id: input.resourceId,
      metadata: input.metadata || {},
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    return db.createAuditLog(logRecord);
  }
  static getLogsForTenant(tenantId, limit = 50, offset = 0) {
    return db.getAuditLogsByTenant(tenantId, limit, offset);
  }
};

// src/domains/tenants/service.ts
var TenantService = class {
  static generateSlug(name) {
    return name.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
  }
  static async createTenant(input) {
    if (!input.name || input.name.trim().length < 2) {
      throw new ValidationError("Workspace name must be at least 2 characters.");
    }
    const slug = input.slug || this.generateSlug(input.name);
    const existing = db.findTenantBySlug(slug);
    if (existing) {
      throw new ConflictError(`Workspace with identifier '${slug}' already exists.`);
    }
    const tenantId = `ten_${Math.random().toString(36).substring(2, 10)}`;
    const newTenant = {
      id: tenantId,
      name: input.name.trim(),
      slug,
      currency: input.currency || "BDT",
      timezone: input.timezone || "Asia/Dhaka",
      language: input.language || "en",
      settings: input.settings || {
        delivery_charge_inside_dhaka: 60,
        delivery_charge_outside_dhaka: 120
      },
      status: "ACTIVE",
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    return db.createTenant(newTenant);
  }
  static getTenantById(id) {
    const tenant = db.findTenantById(id);
    if (!tenant) {
      throw new NotFoundError("Tenant", id);
    }
    return tenant;
  }
  static updateTenantSettings(tenantId, updates) {
    const tenant = this.getTenantById(tenantId);
    const mergedSettings = updates.settings ? { ...tenant.settings, ...updates.settings } : tenant.settings;
    const updated = db.updateTenant(tenantId, {
      ...updates.name ? { name: updates.name.trim() } : {},
      ...updates.currency ? { currency: updates.currency } : {},
      ...updates.timezone ? { timezone: updates.timezone } : {},
      ...updates.language ? { language: updates.language } : {},
      settings: mergedSettings
    });
    if (!updated) {
      throw new NotFoundError("Tenant", tenantId);
    }
    return updated;
  }
};

// src/domains/auth/service.ts
var AuthService = class {
  static async registerTenantWithOwner(input) {
    const normalizedEmail = input.email.trim().toLowerCase();
    if (!input.email || !normalizedEmail.includes("@")) {
      throw new ValidationError("Valid email address is required.");
    }
    if (!input.password || input.password.length < 8) {
      throw new ValidationError("Password must be at least 8 characters long.");
    }
    if (!input.name || input.name.trim().length < 2) {
      throw new ValidationError("Your full name must be at least 2 characters.");
    }
    if (!input.workspaceName || input.workspaceName.trim().length < 2) {
      throw new ValidationError("Workspace name must be at least 2 characters.");
    }
    const existingUser = db.findUserByEmail(normalizedEmail);
    if (existingUser) {
      throw new ConflictError("An account with this email address already exists.");
    }
    const tenant = await TenantService.createTenant({
      name: input.workspaceName,
      currency: input.currency || "BDT"
    });
    const passwordHash = await hashPassword(input.password);
    const userId = `usr_${Math.random().toString(36).substring(2, 10)}`;
    const user = {
      id: userId,
      email: normalizedEmail,
      name: input.name.trim(),
      password_hash: passwordHash,
      status: "ACTIVE",
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    db.createUser(user);
    db.createMembership({
      id: `mem_${Math.random().toString(36).substring(2, 10)}`,
      tenant_id: tenant.id,
      user_id: user.id,
      role: "OWNER",
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    AuditService.log({
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "USER_REGISTERED_AS_OWNER",
      resourceType: "user",
      resourceId: user.id,
      metadata: { workspace: tenant.name, email: user.email }
    });
    const token = await signSessionToken({
      userId: user.id,
      tenantId: tenant.id,
      role: "OWNER",
      email: user.email,
      name: user.name
    });
    return {
      token,
      user: { id: user.id, email: user.email, name: user.name },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, currency: tenant.currency },
      role: "OWNER"
    };
  }
  static async login(email, password, tenantId) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = db.findUserByEmail(normalizedEmail);
    if (!user) {
      throw new AuthenticationError("Invalid email or password.");
    }
    if (user.status === "SUSPENDED" || user.status === "DEACTIVATED") {
      throw new UserSuspendedError();
    }
    const passwordMatches = await verifyPassword(password, user.password_hash);
    if (!passwordMatches) {
      throw new AuthenticationError("Invalid email or password.");
    }
    const memberships = db.findMembershipsByUserId(user.id);
    if (memberships.length === 0) {
      throw new AuthenticationError("No active workspaces associated with this user account.");
    }
    let activeMembership = memberships[0];
    if (tenantId) {
      const match = memberships.find((m) => m.tenant_id === tenantId);
      if (match) activeMembership = match;
    }
    const tenant = db.findTenantById(activeMembership.tenant_id);
    if (!tenant) {
      throw new AuthenticationError("Associated workspace could not be found.");
    }
    if (tenant.status !== "ACTIVE") {
      throw new TenantSuspendedError(tenant.name);
    }
    db.updateUser(user.id, { last_login_at: (/* @__PURE__ */ new Date()).toISOString() });
    AuditService.log({
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "USER_LOGIN",
      resourceType: "session",
      resourceId: user.id,
      metadata: { role: activeMembership.role }
    });
    const token = await signSessionToken({
      userId: user.id,
      tenantId: tenant.id,
      role: activeMembership.role,
      email: user.email,
      name: user.name
    });
    return {
      token,
      user: { id: user.id, email: user.email, name: user.name },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, currency: tenant.currency },
      role: activeMembership.role
    };
  }
  static async resolveRequestContext(token, requestId) {
    const payload = await verifySessionToken(token);
    if (!payload) {
      throw new AuthenticationError("Session expired or invalid. Please sign in again.");
    }
    const user = db.findUserById(payload.userId);
    if (!user) {
      throw new AuthenticationError("User associated with session does not exist.");
    }
    if (user.status !== "ACTIVE") {
      throw new UserSuspendedError();
    }
    const tenant = db.findTenantById(payload.tenantId);
    if (!tenant) {
      throw new AuthenticationError("Workspace associated with session does not exist.");
    }
    if (tenant.status !== "ACTIVE") {
      throw new TenantSuspendedError(tenant.name);
    }
    const membership = db.findMembership(payload.tenantId, payload.userId);
    if (!membership) {
      throw new AuthenticationError("User is no longer a member of this workspace.");
    }
    const permissions = RbacService.getPermissionsForRole(membership.role);
    return {
      requestId: requestId || `req_${Math.random().toString(36).substring(2, 10)}`,
      traceId: `trc_${Math.random().toString(36).substring(2, 10)}`,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        currency: tenant.currency,
        timezone: tenant.timezone,
        language: tenant.language,
        status: tenant.status
      },
      role: membership.role,
      permissions,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
};

// src/domains/users/service.ts
var UserService = class {
  static getUserById(id) {
    const user = db.findUserById(id);
    if (!user) {
      throw new NotFoundError("User", id);
    }
    return user;
  }
  static getUserByEmail(email) {
    return db.findUserByEmail(email);
  }
  static updateUserStatus(userId, status) {
    const updated = db.updateUser(userId, { status });
    if (!updated) {
      throw new NotFoundError("User", userId);
    }
    return updated;
  }
  static updateProfile(userId, updates) {
    if (updates.name && updates.name.trim().length < 2) {
      throw new ValidationError("Name must be at least 2 characters.");
    }
    const updated = db.updateUser(userId, updates);
    if (!updated) {
      throw new NotFoundError("User", userId);
    }
    return updated;
  }
};

// src/domains/invitations/service.ts
var InvitationService = class {
  static createInvitation(tenantId, email, role, actorUserId) {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.includes("@")) {
      throw new ValidationError("Invalid email address provided.");
    }
    const existingUser = db.findUserByEmail(normalizedEmail);
    if (existingUser) {
      const existingMembership = db.findMembership(tenantId, existingUser.id);
      if (existingMembership) {
        throw new ConflictError(`User ${normalizedEmail} is already a member of this workspace.`);
      }
    }
    const token = generateSecureToken(48);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3).toISOString();
    const invitation = {
      id: `inv_${Math.random().toString(36).substring(2, 10)}`,
      tenant_id: tenantId,
      email: normalizedEmail,
      role,
      token,
      status: "PENDING",
      expires_at: expiresAt,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    const created = db.createInvitation(invitation);
    AuditService.log({
      tenantId,
      actorUserId,
      action: "USER_INVITED",
      resourceType: "invitation",
      resourceId: created.id,
      metadata: { email: normalizedEmail, role }
    });
    return created;
  }
  static getInvitationByToken(token) {
    const inv = db.findInvitationByToken(token);
    if (!inv) {
      throw new NotFoundError("Invitation", token);
    }
    if (new Date(inv.expires_at).getTime() < Date.now()) {
      db.updateInvitationStatus(token, "EXPIRED");
      throw new ValidationError("Invitation token has expired.");
    }
    if (inv.status !== "PENDING") {
      throw new ValidationError(`Invitation has already been ${inv.status.toLowerCase()}.`);
    }
    return inv;
  }
  static acceptInvitation(token, userId) {
    const inv = this.getInvitationByToken(token);
    db.createMembership({
      id: `mem_${Math.random().toString(36).substring(2, 10)}`,
      tenant_id: inv.tenant_id,
      user_id: userId,
      role: inv.role,
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    db.updateInvitationStatus(token, "ACCEPTED");
    AuditService.log({
      tenantId: inv.tenant_id,
      actorUserId: userId,
      action: "INVITATION_ACCEPTED",
      resourceType: "membership",
      resourceId: userId,
      metadata: { role: inv.role, invitationId: inv.id }
    });
    return { tenantId: inv.tenant_id, role: inv.role };
  }
  static getInvitationsForTenant(tenantId) {
    return db.findInvitationsByTenant(tenantId);
  }
};

// tests/run-tests.ts
var ANSI_GREEN = "\x1B[32m";
var ANSI_RED = "\x1B[31m";
var ANSI_RESET = "\x1B[0m";
var ANSI_BOLD = "\x1B[1m";
var passedCount = 0;
var failedCount = 0;
async function runTest(testName, testFn) {
  try {
    await testFn();
    console.log(`  ${ANSI_GREEN}\u2713 PASS${ANSI_RESET} - ${testName}`);
    passedCount++;
  } catch (err) {
    console.error(`  ${ANSI_RED}\u2717 FAIL${ANSI_RESET} - ${testName}`);
    console.error(err);
    failedCount++;
  }
}
console.log(`
${ANSI_BOLD}====================================================${ANSI_RESET}`);
console.log(`${ANSI_BOLD}   COMMERCEOS PHASE 1: AUTOMATED VERIFICATION SUITE   ${ANSI_RESET}`);
console.log(`${ANSI_BOLD}====================================================
${ANSI_RESET}`);
async function main() {
  db.clearAllForTesting();
  console.log(`${ANSI_BOLD}[1] Authentication & Cryptographic Security Tests${ANSI_RESET}`);
  await runTest("Password hashing and comparison with bcrypt", async () => {
    const rawPass = "CommerceOS2026!Secure";
    const hashed = await hashPassword(rawPass);
    assert.strictEqual(typeof hashed, "string");
    assert.ok(hashed.length > 20);
    const validMatch = await verifyPassword(rawPass, hashed);
    assert.strictEqual(validMatch, true, "Valid password should verify");
    const invalidMatch = await verifyPassword("WrongPassword123!", hashed);
    assert.strictEqual(invalidMatch, false, "Invalid password should fail");
  });
  await runTest("JWT Session Token signing and verification", async () => {
    const payload = {
      userId: "usr_test_123",
      tenantId: "ten_test_456",
      role: "OWNER",
      email: "owner@test.com",
      name: "Test Owner"
    };
    const token = await signSessionToken(payload);
    assert.ok(token && typeof token === "string");
    const verified = await verifySessionToken(token);
    if (!verified) throw new Error("Session verification failed");
    assert.strictEqual(verified.userId, payload.userId);
    assert.strictEqual(verified.tenantId, payload.tenantId);
    assert.strictEqual(verified.role, payload.role);
  });
  await runTest("Tenant registration with owner account flow", async () => {
    const regResult = await AuthService.registerTenantWithOwner({
      email: "karim@chittagongsilk.com",
      password: "SuperSecretPassword123!",
      name: "Karim Chowdhury",
      workspaceName: "Chittagong Silk & Craft",
      currency: "BDT"
    });
    assert.ok(regResult.token);
    assert.strictEqual(regResult.role, "OWNER");
    assert.strictEqual(regResult.tenant.name, "Chittagong Silk & Craft");
    assert.strictEqual(regResult.tenant.currency, "BDT");
    assert.strictEqual(regResult.user.email, "karim@chittagongsilk.com");
    const tenantInDb = db.findTenantById(regResult.tenant.id);
    if (!tenantInDb) throw new Error("Tenant should exist in database");
    assert.strictEqual(tenantInDb.status, "ACTIVE");
    const userInDb = db.findUserByEmail("karim@chittagongsilk.com");
    if (!userInDb) throw new Error("User should exist in database");
    assert.strictEqual(userInDb.status, "ACTIVE");
    const membership = db.findMembership(regResult.tenant.id, userInDb.id);
    if (!membership) throw new Error("Membership should exist in database");
    assert.strictEqual(membership.role, "OWNER");
  });
  await runTest("Login flow with valid credentials", async () => {
    const loginResult = await AuthService.login(
      "karim@chittagongsilk.com",
      "SuperSecretPassword123!"
    );
    assert.ok(loginResult.token);
    assert.strictEqual(loginResult.user.email, "karim@chittagongsilk.com");
    assert.strictEqual(loginResult.role, "OWNER");
  });
  await runTest("Login rejection on incorrect password", async () => {
    let threw = false;
    try {
      await AuthService.login("karim@chittagongsilk.com", "WrongPassword999!");
    } catch (e) {
      threw = true;
      assert.ok(e instanceof AuthenticationError);
    }
    assert.strictEqual(threw, true, "Should reject incorrect password");
  });
  await runTest("Suspended user cannot log in", async () => {
    const user = db.findUserByEmail("karim@chittagongsilk.com");
    if (!user) throw new Error("User must exist in test database");
    UserService.updateUserStatus(user.id, "SUSPENDED");
    let threw = false;
    try {
      await AuthService.login("karim@chittagongsilk.com", "SuperSecretPassword123!");
    } catch (e) {
      threw = true;
      assert.ok(e instanceof UserSuspendedError);
    }
    assert.strictEqual(threw, true, "Suspended user must be denied login");
    UserService.updateUserStatus(user.id, "ACTIVE");
  });
  console.log(`
${ANSI_BOLD}[2] Mandatory Multi-Tenant Boundary Isolation Tests${ANSI_RESET}`);
  const tenantAlpha = await AuthService.registerTenantWithOwner({
    email: "alpha_owner@alphastore.com",
    password: "PasswordAlpha123!",
    name: "Alpha Owner",
    workspaceName: "Alpha Retailers"
  });
  const tenantBeta = await AuthService.registerTenantWithOwner({
    email: "beta_owner@betastore.com",
    password: "PasswordBeta123!",
    name: "Beta Owner",
    workspaceName: "Beta Brand"
  });
  await runTest("CRITICAL: Tenant Alpha cannot access Tenant Beta memberships", async () => {
    const contextAlpha = await AuthService.resolveRequestContext(tenantAlpha.token);
    assert.strictEqual(contextAlpha.tenant.id, tenantAlpha.tenant.id);
    const alphaMemberships = db.findMembershipsByTenantId(contextAlpha.tenant.id);
    assert.ok(alphaMemberships.length > 0);
    const betaUserInAlpha = alphaMemberships.find(
      (m) => m.user_id === tenantBeta.user.id
    );
    assert.strictEqual(
      betaUserInAlpha,
      void 0,
      "Tenant Beta membership must NEVER appear in Tenant Alpha dataset!"
    );
  });
  await runTest("CRITICAL: Tenant Alpha cannot mutate Tenant Beta settings", async () => {
    const contextAlpha = await AuthService.resolveRequestContext(tenantAlpha.token);
    TenantService.updateTenantSettings(contextAlpha.tenant.id, {
      name: "Alpha Retailers Renamed",
      currency: "USD"
    });
    const refreshedBeta = TenantService.getTenantById(tenantBeta.tenant.id);
    assert.strictEqual(
      refreshedBeta.name,
      "Beta Brand",
      "Tenant Beta name must remain unmutated by Tenant Alpha actions!"
    );
    assert.strictEqual(
      refreshedBeta.currency,
      "BDT",
      "Tenant Beta currency must remain BDT!"
    );
  });
  await runTest("CRITICAL: Tenant Alpha cannot view Tenant Beta audit logs", async () => {
    AuditService.log({
      tenantId: tenantBeta.tenant.id,
      actorUserId: tenantBeta.user.id,
      action: "BETA_SECRET_ACTION",
      resourceType: "financial_record",
      resourceId: "fin_999",
      metadata: { private_revenue: 5e5 }
    });
    const alphaLogs = AuditService.getLogsForTenant(tenantAlpha.tenant.id);
    const leakedLog = alphaLogs.logs.find(
      (l) => l.action === "BETA_SECRET_ACTION" || l.tenant_id === tenantBeta.tenant.id
    );
    assert.strictEqual(
      leakedLog,
      void 0,
      "Tenant Alpha audit query must NEVER return Tenant Beta audit records!"
    );
  });
  console.log(`
${ANSI_BOLD}[3] Role-Based Access Control (RBAC) Permission Tests${ANSI_RESET}`);
  await runTest("OWNER possesses full permissions across all scopes", async () => {
    const ownerPerms = RbacService.getPermissionsForRole("OWNER");
    assert.strictEqual(ownerPerms.length, Object.values(PERMISSIONS).length);
    assert.ok(ownerPerms.includes(PERMISSIONS.WORKSPACE_UPDATE));
    assert.ok(ownerPerms.includes(PERMISSIONS.USER_INVITE));
    assert.ok(ownerPerms.includes(PERMISSIONS.SETTINGS_UPDATE));
    assert.ok(ownerPerms.includes(PERMISSIONS.AUDIT_READ));
  });
  await runTest("ADMIN can invite users, update settings, but cannot delete workspace", async () => {
    const adminPerms = RbacService.getPermissionsForRole("ADMIN");
    assert.ok(adminPerms.includes(PERMISSIONS.USER_INVITE));
    assert.ok(adminPerms.includes(PERMISSIONS.SETTINGS_UPDATE));
    assert.ok(adminPerms.includes(PERMISSIONS.AUDIT_READ));
    assert.strictEqual(adminPerms.includes(PERMISSIONS.WORKSPACE_DELETE), false);
  });
  await runTest("SALES role has orders/products read/write but lacks settings/audit permissions", async () => {
    const salesPerms = RbacService.getPermissionsForRole("SALES");
    assert.ok(salesPerms.includes(PERMISSIONS.ORDERS_WRITE));
    assert.ok(salesPerms.includes(PERMISSIONS.PRODUCTS_READ));
    assert.strictEqual(salesPerms.includes(PERMISSIONS.SETTINGS_UPDATE), false);
    assert.strictEqual(salesPerms.includes(PERMISSIONS.AUDIT_READ), false);
    assert.strictEqual(salesPerms.includes(PERMISSIONS.USER_INVITE), false);
  });
  await runTest("SUPPORT role cannot mutate settings or alter financial ledgers", async () => {
    const supportPerms = RbacService.getPermissionsForRole("SUPPORT");
    assert.ok(supportPerms.includes(PERMISSIONS.SUPPORT_READ));
    assert.strictEqual(supportPerms.includes(PERMISSIONS.PAYMENTS_REFUND), false);
    assert.strictEqual(supportPerms.includes(PERMISSIONS.SETTINGS_UPDATE), false);
  });
  await runTest("ANALYST role is strictly read-only and cannot mutate data", async () => {
    const analystPerms = RbacService.getPermissionsForRole("ANALYST");
    assert.ok(analystPerms.includes(PERMISSIONS.ANALYTICS_READ));
    assert.strictEqual(analystPerms.includes(PERMISSIONS.ORDERS_WRITE), false);
    assert.strictEqual(analystPerms.includes(PERMISSIONS.PRODUCTS_WRITE), false);
    assert.strictEqual(analystPerms.includes(PERMISSIONS.USER_INVITE), false);
  });
  await runTest("assertCan() enforces permission boundaries and throws ForbiddenError", async () => {
    const salesContext = {
      requestId: "req_test",
      traceId: "trc_test",
      user: { id: "usr_sales_1", email: "sales@test.com", name: "Sales Rep", status: "ACTIVE" },
      tenant: { id: tenantAlpha.tenant.id, name: "Alpha", slug: "alpha", currency: "BDT", timezone: "Asia/Dhaka", language: "en", status: "ACTIVE", settings: {} },
      role: "SALES",
      permissions: RbacService.getPermissionsForRole("SALES"),
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    assert.doesNotThrow(() => {
      RbacService.assertCan(salesContext, PERMISSIONS.DASHBOARD_READ);
    });
    let forbiddenThrew = false;
    try {
      RbacService.assertCan(salesContext, PERMISSIONS.SETTINGS_UPDATE);
    } catch (e) {
      forbiddenThrew = true;
      assert.ok(e instanceof ForbiddenError);
    }
    assert.strictEqual(forbiddenThrew, true, "Sales role must be forbidden from updating settings");
  });
  console.log(`
${ANSI_BOLD}[4] Invitation & Team Member Onboarding Tests${ANSI_RESET}`);
  await runTest("Admin invites new member -> Generates secure expiring invitation", async () => {
    const inv = InvitationService.createInvitation(
      tenantAlpha.tenant.id,
      "manager@alphastore.com",
      "MANAGER",
      tenantAlpha.user.id
    );
    assert.ok(inv.id);
    assert.strictEqual(inv.email, "manager@alphastore.com");
    assert.strictEqual(inv.role, "MANAGER");
    assert.strictEqual(inv.status, "PENDING");
    assert.ok(inv.token.length >= 32);
    const fetched = InvitationService.getInvitationByToken(inv.token);
    assert.strictEqual(fetched.id, inv.id);
  });
  await runTest("Accepting invitation creates user membership in tenant", async () => {
    const invitee = db.createUser({
      id: "usr_new_manager",
      email: "manager@alphastore.com",
      name: "Farhan Ahmed",
      password_hash: await hashPassword("ManagerPass123!"),
      status: "ACTIVE",
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    const pendingInv = InvitationService.getInvitationsForTenant(tenantAlpha.tenant.id).find(
      (i) => i.email === "manager@alphastore.com" && i.status === "PENDING"
    );
    if (!pendingInv) throw new Error("Pending invitation must exist");
    const result = InvitationService.acceptInvitation(pendingInv.token, invitee.id);
    assert.strictEqual(result.tenantId, tenantAlpha.tenant.id);
    assert.strictEqual(result.role, "MANAGER");
    const membership = db.findMembership(tenantAlpha.tenant.id, invitee.id);
    if (!membership) throw new Error("Membership must exist");
    assert.strictEqual(membership.role, "MANAGER");
    const updatedInv = db.findInvitationByToken(pendingInv.token);
    if (!updatedInv) throw new Error("Updated invitation must exist");
    assert.strictEqual(updatedInv.status, "ACCEPTED");
  });
  console.log(`
${ANSI_BOLD}[5] Audit Logging & Operational Trail Tests${ANSI_RESET}`);
  await runTest("Audit logging records security events with actor and tenant context", async () => {
    const auditRecord = AuditService.log({
      tenantId: tenantAlpha.tenant.id,
      actorUserId: tenantAlpha.user.id,
      action: "SETTINGS_UPDATED",
      resourceType: "tenant",
      resourceId: tenantAlpha.tenant.id,
      metadata: { delivery_fee_inside: 70 },
      ipAddress: "127.0.0.1",
      userAgent: "CommerceOS-Test-Runner/1.0"
    });
    assert.ok(auditRecord.id);
    assert.strictEqual(auditRecord.action, "SETTINGS_UPDATED");
    assert.strictEqual(auditRecord.tenant_id, tenantAlpha.tenant.id);
    assert.strictEqual(auditRecord.actor_user_id, tenantAlpha.user.id);
    assert.strictEqual(auditRecord.metadata.delivery_fee_inside, 70);
    const logs = AuditService.getLogsForTenant(tenantAlpha.tenant.id);
    assert.ok(logs.total > 0);
    const found = logs.logs.find((l) => l.id === auditRecord.id);
    assert.ok(found);
  });
  console.log(`
${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`   TEST EXECUTION SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log(`${ANSI_BOLD}====================================================
${ANSI_RESET}`);
  if (failedCount > 0) {
    process.exit(1);
  }
}
main().catch((err) => {
  console.error("Fatal test suite failure:", err);
  process.exit(1);
});
