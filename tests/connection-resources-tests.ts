/**
 * Connection platform P0 (ADR-119, docs/connection-platform-plan.md): the `connection_resources` collection, its
 * tenant-scoped accessors, the one-workspace rule for Pages / Instagram / WhatsApp / Telegram (audit H5), and the
 * manifest auth fields.
 * Run: node tests/ts-runner.cjs ./tests/connection-resources-tests.ts
 */
// @ts-ignore
import assert from "assert";
import crypto from "crypto";
declare const process: { exit(code?: number): void; env: Record<string, string | undefined> };
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { PROVIDER_MANIFESTS } from "@/domains/connectors/manifests";
import { encryptCredential } from "@/lib/security";
import { ConflictError, NotFoundError } from "@/lib/errors";
import {
  CONNECTION_RESOURCE_KINDS,
  type ConnectionResource,
  type ConnectionResourceKind,
  type ConnectorConfigRecord,
} from "@/types/connector";

const ANSI_GREEN = "\x1b[32m";
const ANSI_RED = "\x1b[31m";
const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";

let passedCount = 0;
let failedCount = 0;

async function runTest(testName: string, testFn: () => Promise<void> | void) {
  try {
    await testFn();
    console.log(`  ${ANSI_GREEN}✓ PASS${ANSI_RESET} - ${testName}`);
    passedCount++;
  } catch (err) {
    console.error(`  ${ANSI_RED}✗ FAIL${ANSI_RESET} - ${testName}`);
    console.error(err);
    failedCount++;
  }
}

const now = () => new Date().toISOString();

function connection(tenantId: string, providerId = "meta_graph"): ConnectorConfigRecord {
  const record: ConnectorConfigRecord = {
    id: `conn_${crypto.randomUUID().slice(0, 12)}`,
    tenant_id: tenantId,
    provider_id: providerId,
    category: "SOCIAL_ADS",
    name: "Meta",
    credentials_encrypted: encryptCredential({ access_token: "USER_TOKEN" }),
    credentials_masked: {},
    configuration: {},
    status: "ACTIVE",
    health_status: "UNVERIFIED",
    auth_method: "oauth2",
    connection_status: "ACTIVE",
    created_at: now(),
    updated_at: now(),
  };
  db.saveConnector(record);
  return record;
}

function resource(tenantId: string, connectionId: string, kind: ConnectionResourceKind, externalId: string): ConnectionResource {
  return {
    id: `cres_${crypto.randomUUID().slice(0, 12)}`,
    tenant_id: tenantId,
    connection_id: connectionId,
    kind,
    external_id: externalId,
    name: `${kind} ${externalId}`,
    metadata: {},
    status: "ACTIVE",
    created_at: now(),
    updated_at: now(),
  };
}

async function main() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   CONNECTION RESOURCES (ADR-119, P0)               ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  db.clearAllForTesting();
  const stamp = Date.now();
  const regA = await AuthService.registerTenantWithOwner({ workspaceName: `Res Shop A ${stamp}`, name: "Owner A", email: `res-a-${stamp}@example.com`, password: "Password12345!" });
  const regB = await AuthService.registerTenantWithOwner({ workspaceName: `Res Shop B ${stamp}`, name: "Owner B", email: `res-b-${stamp}@example.com`, password: "Password12345!" });
  const A = regA.tenant.id;
  const B = regB.tenant.id;
  const connA = connection(A);
  const connA2 = connection(A);
  const connB = connection(B);

  console.log(`${ANSI_BOLD}[Store accessors]${ANSI_RESET}`);

  const pageA = resource(A, connA.id, "FB_PAGE", "1001");
  const adA = resource(A, connA.id, "AD_ACCOUNT", "55500011");

  await runTest("a new store has an empty collection and a workspace sees only its own resources", () => {
    assert.deepStrictEqual(db.getConnectionResources(B), []);
    db.createConnectionResource(pageA);
    db.createConnectionResource(adA);
    db.createConnectionResource(resource(A, connA2.id, "FB_PAGE", "1002"));
    assert.strictEqual(db.getConnectionResources(A).length, 3);
    assert.deepStrictEqual(db.getConnectionResources(A, connA.id).map((r) => r.external_id).sort(), ["1001", "55500011"]);
    assert.deepStrictEqual(db.getConnectionResources(B), []);
    assert.strictEqual(db.getConnectionResources(B, connA.id).length, 0, "another tenant's connection id finds nothing");
  });

  await runTest("lookup by id is tenant-scoped", () => {
    assert.strictEqual(db.findConnectionResource(A, pageA.id)?.external_id, "1001");
    assert.strictEqual(db.findConnectionResource(B, pageA.id), undefined);
  });

  await runTest("a Page connected in workspace A can't be connected in workspace B (H5)", () => {
    assert.throws(() => db.createConnectionResource(resource(B, connB.id, "FB_PAGE", "1001")), ConflictError);
    assert.strictEqual(db.getConnectionResources(B).length, 0);
  });

  await runTest("Instagram, WhatsApp numbers and Telegram bots are one-workspace too", () => {
    for (const kind of ["IG_ACCOUNT", "WA_NUMBER", "TELEGRAM_BOT"] as const) {
      db.createConnectionResource(resource(A, connA.id, kind, `${kind}-x`));
      assert.throws(() => db.createConnectionResource(resource(B, connB.id, kind, `${kind}-x`)), ConflictError, kind);
    }
  });

  await runTest("an ad account can be used by two workspaces, but not twice in one", () => {
    db.createConnectionResource(resource(B, connB.id, "AD_ACCOUNT", "55500011"));
    assert.throws(() => db.createConnectionResource(resource(A, connA2.id, "AD_ACCOUNT", "55500011")), ConflictError);
  });

  await runTest("a reused id is refused, even from another workspace", () => {
    assert.throws(() => db.createConnectionResource({ ...pageA, tenant_id: B, connection_id: connB.id, external_id: "2002" }), ConflictError);
  });

  await runTest("after A detaches its Page, B can connect it; A can't revive it while B holds it", () => {
    db.updateConnectionResource(A, pageA.id, { status: "DETACHED" });
    const pageB = db.createConnectionResource(resource(B, connB.id, "FB_PAGE", "1001"));
    assert.strictEqual(db.findLiveConnectionResourcesByExternalId("FB_PAGE", "1001").map((r) => r.tenant_id).join(), B);
    assert.throws(() => db.updateConnectionResource(A, pageA.id, { status: "ACTIVE" }), ConflictError);
    assert.strictEqual(db.findConnectionResource(A, pageA.id)?.status, "DETACHED", "a refused update changes nothing");
    db.updateConnectionResource(B, pageB.id, { status: "DETACHED" });
  });

  await runTest("an update can't move a resource to another tenant, connection, kind or provider id", () => {
    const patch = { tenant_id: B, connection_id: connB.id, kind: "SHOP", external_id: "9", name: "Ads (renamed)", id: "cres_other" } as unknown as Partial<ConnectionResource>;
    const updated = db.updateConnectionResource(A, adA.id, patch);
    assert.deepStrictEqual(
      [updated.id, updated.tenant_id, updated.connection_id, updated.kind, updated.external_id, updated.name],
      [adA.id, A, connA.id, "AD_ACCOUNT", "55500011", "Ads (renamed)"]
    );
  });

  await runTest("another workspace can't update A's resource", () => {
    assert.throws(() => db.updateConnectionResource(B, adA.id, { name: "taken" }), NotFoundError);
    assert.strictEqual(db.findConnectionResource(A, adA.id)?.name, "Ads (renamed)");
  });

  await runTest("deleting resources of a connection is tenant-scoped", () => {
    assert.strictEqual(db.deleteConnectionResources(B, connA.id), 0);
    const before = db.getConnectionResources(A, connA2.id).length;
    assert.strictEqual(db.deleteConnectionResources(A, connA2.id), before);
    assert.strictEqual(db.getConnectionResources(A, connA2.id).length, 0);
    assert.ok(db.getConnectionResources(A, connA.id).length > 0, "other connections keep theirs");
  });

  await runTest("deleting a connector deletes its resources", () => {
    assert.ok(db.deleteConnector(A, connA.id));
    assert.strictEqual(db.getConnectionResources(A, connA.id).length, 0);
    assert.ok(db.getConnectionResources(B).length > 0, "workspace B is untouched");
  });

  await runTest("a stored resource token is encrypted, never plain", () => {
    const conn = connection(A);
    const page = db.createConnectionResource({ ...resource(A, conn.id, "FB_PAGE", "3003"), token_encrypted: encryptCredential({ token: "PAGE_TOKEN_PLAIN" }) });
    assert.ok(!JSON.stringify(db.findConnectionResource(A, page.id)).includes("PAGE_TOKEN_PLAIN"));
  });

  console.log(`\n${ANSI_BOLD}[Manifest auth fields]${ANSI_RESET}`);

  await runTest("every provider declares a known auth method and known resource kinds", () => {
    for (const p of PROVIDER_MANIFESTS) {
      assert.ok(["oauth2", "embedded_signup", "api_key", "bot_token"].includes(p.auth_method), `${p.id}: ${p.auth_method}`);
      for (const kind of p.resource_kinds) assert.ok(CONNECTION_RESOURCE_KINDS.includes(kind), `${p.id}: ${kind}`);
    }
  });

  await runTest("connectable sign-in providers declare their base scopes; no scope is both base and optional", () => {
    for (const p of PROVIDER_MANIFESTS) {
      if (p.status !== "COMING_SOON" && (p.auth_method === "oauth2" || p.auth_method === "embedded_signup")) {
        assert.ok((p.base_scopes ?? []).length > 0, `${p.id} has no base scopes`);
      }
      const base = new Set(p.base_scopes ?? []);
      for (const opt of p.optional_scopes ?? []) {
        for (const scope of opt.scopes) assert.ok(!base.has(scope), `${p.id}: ${scope} is both base and optional`);
      }
      if (p.auth_method === "api_key" || p.auth_method === "bot_token") {
        assert.strictEqual(p.base_scopes, undefined, `${p.id}: scopes on a non-sign-in provider`);
      }
    }
  });

  await runTest("Meta: ads_read is asked only by the ads feature; Pages, Instagram and ad accounts are pickable", () => {
    const meta = PROVIDER_MANIFESTS.find((p) => p.id === "meta_graph")!;
    assert.ok(!meta.base_scopes?.includes("ads_read"));
    assert.deepStrictEqual(meta.optional_scopes, [{ feature: "ads", scopes: ["ads_read"] }]);
    assert.deepStrictEqual(meta.resource_kinds, ["FB_PAGE", "IG_ACCOUNT", "AD_ACCOUNT"]);
  });

  console.log(`\n${ANSI_BOLD}Results: ${passedCount} passed, ${failedCount} failed${ANSI_RESET}\n`);
  if (failedCount > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
