/**
 * Connection platform P6 (ADR-119): what the Connectors page and the super-admin console read about connections.
 * Run: node tests/ts-runner.cjs ./tests/connections-view-tests.ts
 */
// @ts-ignore
import assert from "assert";
declare const process: { exit(code?: number): void; env: Record<string, string | undefined> };
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { ConnectionsService } from "@/domains/connectors/connections.service";
import { PROVIDER_MANIFESTS } from "@/domains/connectors/manifests";
import { encryptCredential } from "@/lib/security";
import { PERMISSIONS } from "@/lib/permissions";
import { ForbiddenError } from "@/lib/errors";
import type { RequestContext } from "@/lib/context";
import type { ConnectorConfigRecord } from "@/types/connector";
import { GET as listRoute } from "@/app/api/v1/connections/route";
import { GET as platformHealthRoute } from "@/app/api/v1/platform/connections/health/route";

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

const DAY = 86_400_000;
const BASE = PROVIDER_MANIFESTS.find((p) => p.id === "meta_graph")!.base_scopes!;

async function main() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   CONNECTIONS VIEW (ADR-119, P6)                   ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  db.clearAllForTesting();
  const stamp = Date.now();
  const reg = (n: string) =>
    AuthService.registerTenantWithOwner({ workspaceName: `View ${n} ${stamp}`, name: `Owner ${n}`, email: `view-${n}-${stamp}@example.com`, password: "Password12345!" });
  const regA = await reg("a");
  const regB = await reg("b");
  const ctx = (r: typeof regA, permissions = Object.values(PERMISSIONS)): RequestContext => ({
    requestId: "req_view",
    traceId: "trc_view",
    user: { id: r.user.id, email: r.user.email, name: r.user.name, status: "ACTIVE" },
    tenant: { id: r.tenant.id, name: r.tenant.name, slug: r.tenant.slug, currency: "BDT", timezone: "Asia/Dhaka", language: "en", status: "ACTIVE" },
    role: "OWNER",
    permissions,
    timestamp: new Date().toISOString(),
  });
  const A = regA.tenant.id;
  const at = new Date().toISOString();
  let seq = 0;
  const connection = (tenantId: string, owner: string, provider: string, extra: Partial<ConnectorConfigRecord>) =>
    db.saveConnector({
      id: `conn_view_${seq++}`,
      tenant_id: tenantId,
      provider_id: provider,
      category: "SOCIAL_ADS",
      name: `${provider} (sign-in)`,
      credentials_encrypted: encryptCredential({ access_token: "SECRET_USER_TOKEN", kind: "user" }),
      credentials_masked: { access_token: "SECR...OKEN" },
      configuration: {},
      status: "ACTIVE",
      health_status: "HEALTHY",
      enabled: true,
      auth_method: "oauth2",
      owner_user_id: owner,
      external_account_id: "7001",
      scopes_granted: [...BASE, "ads_read"],
      connection_status: "ACTIVE",
      token_expires_at: new Date(Date.now() + 40 * DAY).toISOString(),
      created_at: at,
      updated_at: at,
      ...extra,
    });

  const meta = connection(A, regA.user.id, "meta_graph", {});
  const page = db.createConnectionResource({
    id: `cres_view_${stamp}`, tenant_id: A, connection_id: meta.id, kind: "FB_PAGE", external_id: "1001", name: "Dhaka Threads",
    metadata: {}, token_encrypted: encryptCredential({ token: "SECRET_PAGE_TOKEN" }), status: "ACTIVE", created_at: at, updated_at: at,
  });
  db.createConnectionResource({
    id: `cres_view_old_${stamp}`, tenant_id: A, connection_id: meta.id, kind: "FB_PAGE", external_id: "1009", name: "Old page",
    metadata: {}, status: "DETACHED", created_at: at, updated_at: at,
  });
  const lastEvent = new Date(Date.now() - 5 * 60_000).toISOString();
  db.createConnectedChannel({
    id: `chn_view_${stamp}`, tenant_id: A, type: "FACEBOOK_MESSENGER", name: "Dhaka Threads", status: "ACTIVE", provider_account_id: "1001",
    credentials_encrypted: encryptCredential({ accessToken: "SECRET_PAGE_TOKEN" }), resource_id: page.id, last_webhook_at: lastEvent,
    configuration: {}, created_at: at, updated_at: at,
  });
  connection(A, "usr_gone", "whatsapp_cloud", { connection_status: "NEEDS_REAUTH", health_code: "OWNER_LEFT", scopes_granted: ["whatsapp_business_management"] });
  connection(regB.tenant.id, regB.user.id, "meta_graph", { connection_status: "DEGRADED", health_code: "TOKEN_EXPIRING", token_expires_at: new Date(Date.now() + 3 * DAY).toISOString() });

  await runTest("a workspace lists only its own connections, with no credentials or tokens", () => {
    const { connections } = ConnectionsService.list(ctx(regA));
    assert.deepStrictEqual(connections.map((c) => c.provider_id).sort(), ["meta_graph", "whatsapp_cloud"]);
    const json = JSON.stringify(connections);
    for (const secret of ["SECRET_USER_TOKEN", "SECRET_PAGE_TOKEN", "credentials", "token_encrypted", "external_account_id"]) {
      assert.ok(!json.includes(secret), secret);
    }
  });

  await runTest("a connection shows its owner, scopes, optional features and live resources with their last message", () => {
    const view = ConnectionsService.list(ctx(regA)).connections.find((c) => c.provider_id === "meta_graph")!;
    assert.deepStrictEqual([view.owner?.name, view.owner?.still_member], [regA.user.name, true]);
    assert.deepStrictEqual(view.scopes_missing, []);
    assert.deepStrictEqual(view.optional, [{ feature: "ads", granted: true }]);
    assert.deepStrictEqual(view.resources.map((r) => [r.kind, r.name, r.channel?.last_event_at]), [["FB_PAGE", "Dhaka Threads", lastEvent]]);
  });

  await runTest("missing required scopes and an owner who left are reported", () => {
    const wa = ConnectionsService.list(ctx(regA)).connections.find((c) => c.provider_id === "whatsapp_cloud")!;
    assert.deepStrictEqual(wa.scopes_missing, ["whatsapp_business_messaging"]);
    assert.strictEqual(wa.owner, undefined, "unknown user: no owner shown");
    assert.strictEqual(wa.health_code, "OWNER_LEFT");
  });

  await runTest("card summaries come from connection status, not from a save", () => {
    const a = new Map(ConnectionsService.list(ctx(regA)).summaries.map((s) => [s.provider_id, s]));
    assert.deepStrictEqual([a.get("meta_graph")?.state, a.get("meta_graph")?.last_event_at], ["CONNECTED", lastEvent]);
    assert.strictEqual(a.get("whatsapp_cloud")?.state, "REAUTH");
    const b = ConnectionsService.list(ctx(regB)).summaries.find((s) => s.provider_id === "meta_graph")!;
    assert.strictEqual(b.state, "ATTENTION");
    assert.ok(b.expires_at && Date.parse(b.expires_at) < Date.now() + 4 * DAY);
  });

  await runTest("a disabled connection isn't shown as connected", () => {
    db.saveConnector({ ...db.findConnectorById(A, meta.id)!, enabled: false });
    try {
      const s = ConnectionsService.list(ctx(regA)).summaries.find((x) => x.provider_id === "meta_graph")!;
      assert.notStrictEqual(s.state, "CONNECTED");
    } finally {
      db.saveConnector({ ...db.findConnectorById(A, meta.id)!, enabled: true });
    }
  });

  await runTest("the owner's name is shown only to roles that can list the team; never their user id", () => {
    const noUserRead = Object.values(PERMISSIONS).filter((p) => p !== PERMISSIONS.USER_READ);
    const view = ConnectionsService.list(ctx(regA, noUserRead)).connections.find((c) => c.provider_id === "meta_graph")!;
    assert.deepStrictEqual(view.owner, { name: undefined, still_member: true });
    const json = JSON.stringify(ConnectionsService.list(ctx(regA)).connections);
    assert.ok(!json.includes(regA.user.id), "no owner user id");
  });

  await runTest("listing needs settings.read", () => {
    assert.throws(() => ConnectionsService.list(ctx(regA, [PERMISSIONS.SOCIAL_CHANNEL_READ])), ForbiddenError);
  });

  await runTest("GET /api/v1/connections answers for the session's workspace and writes nothing", async () => {
    const { token } = await AuthService.login(regA.user.email, "Password12345!");
    const before = JSON.stringify([db.data.connector_configurations, db.data.connection_resources]);
    const res = await listRoute(new Request("https://shop.example.com/api/v1/connections", { headers: { authorization: `Bearer ${token}` } }));
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { data: { connections: Array<{ provider_id: string }> } };
    assert.strictEqual(body.data.connections.length, 2);
    assert.strictEqual(JSON.stringify([db.data.connector_configurations, db.data.connection_resources]), before);
  });

  console.log(`\n${ANSI_BOLD}[Super-admin health]${ANSI_RESET}`);

  await runTest("platform health is counts only: no workspace, account or token", () => {
    const h = ConnectionsService.platformHealth();
    const metaRow = h.by_provider.find((p) => p.provider_id === "meta_graph")!;
    assert.deepStrictEqual([metaRow.total, metaRow.by_status.ACTIVE, metaRow.by_status.DEGRADED], [2, 1, 1]);
    assert.strictEqual(h.workspaces_needing_reauth, 1);
    assert.strictEqual(h.expiring_within_7_days, 1);
    const json = JSON.stringify(h);
    for (const leak of [A, regB.tenant.id, "7001", "SECRET", regA.tenant.name]) assert.ok(!json.includes(leak), leak);
  });

  await runTest("the platform health route refuses a workspace session", async () => {
    const { token } = await AuthService.login(regA.user.email, "Password12345!");
    const res = await platformHealthRoute(new Request("https://shop.example.com/api/v1/platform/connections/health", { headers: { authorization: `Bearer ${token}` } }));
    assert.ok(res.status === 401 || res.status === 403, String(res.status));
  });

  console.log(`\n${ANSI_BOLD}Results: ${passedCount} passed, ${failedCount} failed${ANSI_RESET}\n`);
  if (failedCount > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
