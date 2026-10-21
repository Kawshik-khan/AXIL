/**
 * Connection platform P2 (ADR-119): moving "Connect with Facebook" channels onto connections and resources.
 * Run: node tests/ts-runner.cjs ./tests/connection-migration-tests.ts
 */
// @ts-ignore
import assert from "assert";
declare const process: { exit(code?: number): void; env: Record<string, string | undefined> };
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { ChannelService } from "@/domains/social/channels/channel.service";
import { resolveMetaReadCredentials } from "@/domains/social/insights/meta-graph-reader";
import { migrateChannelsToConnections } from "@/domains/connectors/migrate-channels";
import { encryptCredential } from "@/lib/security";
import type { ChannelType, ConnectedChannel } from "@/types/social";

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

let seq = 0;
function channel(tenantId: string, type: ChannelType, accountId: string, creds: Record<string, unknown>): ConnectedChannel {
  const at = new Date().toISOString();
  return db.createConnectedChannel({
    id: `chn_mig_${Date.now()}_${seq++}`,
    tenant_id: tenantId,
    type,
    name: `${type} ${accountId}`,
    status: "ACTIVE",
    provider_account_id: accountId,
    external_page_id: accountId,
    credentials_encrypted: encryptCredential(creds),
    configuration: {},
    created_at: at,
    updated_at: at,
  });
}

/** Everything the migration may touch, for "nothing changed" checks. */
const snapshot = () => JSON.stringify([db.data.connected_channels, db.data.connector_configurations, db.data.connection_resources]);

async function main() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   CHANNEL → CONNECTION MIGRATION (ADR-119, P2)     ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  db.clearAllForTesting();
  const stamp = Date.now();
  const reg = (n: string) =>
    AuthService.registerTenantWithOwner({ workspaceName: `Mig ${n} ${stamp}`, name: `Owner ${n}`, email: `mig-${n}-${stamp}@example.com`, password: "Password12345!" });
  const regA = await reg("a");
  const regB = await reg("b");
  const regC = await reg("c");
  const A = regA.tenant.id;
  const B = regB.tenant.id;
  const C = regC.tenant.id;
  const ownerA = regA.user.id;

  // A: Page + Instagram from Facebook login; the first ad-account release left the user token on the Page channel
  const fbA = channel(A, "FACEBOOK_MESSENGER", "2001", {
    accessToken: "PAGE_TOKEN_A",
    pageId: "2001",
    connectedVia: "facebook_login",
    connectedBy: ownerA,
    adAccountId: "77700011",
    adAccountName: "A ads",
    adsToken: "LEGACY_USER_TOKEN_A",
    adsTokenOwner: ownerA,
  });
  const igA = channel(A, "INSTAGRAM", "1784001", { accessToken: "PAGE_TOKEN_A", pageId: "2001", connectedVia: "facebook_login", connectedBy: ownerA });
  // B: Facebook login, no ad account; and a Page connected with a pasted token
  const fbB = channel(B, "FACEBOOK_MESSENGER", "3001", { accessToken: "PAGE_TOKEN_B", pageId: "3001", connectedVia: "facebook_login", connectedBy: regB.user.id });
  const manualB = channel(B, "FACEBOOK_MESSENGER", "3002", { accessToken: "PASTED_TOKEN_B" });
  // A website chat is never touched
  channel(C, "WEBSITE_CHAT", "site_c", {});

  await runTest("the dry run reports the plan and changes nothing", () => {
    const before = snapshot();
    const report = migrateChannelsToConnections(false);
    assert.strictEqual(snapshot(), before);
    assert.deepStrictEqual([report.migrated, report.connectionsCreated, report.adAccountsBound], [3, 2, 1]);
    // The demo seed's placeholder channels are skipped too (unreadable credentials)
    assert.ok(report.lines.some((l) => l.includes(manualB.id) && l.includes("pasted token")));
    const text = report.lines.join("\n");
    assert.ok(text.includes("pasted token"), "the pasted-token channel is reported");
    assert.ok(!/TOKEN_/.test(text), "no token in the report");
  });

  await runTest("apply: A gets a connection holding the old ad token, owned by who connected it", () => {
    const report = migrateChannelsToConnections(true);
    assert.strictEqual(report.migrated, 3);
    const conns = db.getConnectors(A).filter((c) => c.auth_method === "oauth2");
    assert.strictEqual(conns.length, 1);
    assert.deepStrictEqual(
      [conns[0].owner_user_id, conns[0].connection_status, conns[0].health_code],
      [ownerA, "ACTIVE", "MIGRATED_NOT_INSPECTED"]
    );
    assert.ok(!JSON.stringify(conns[0]).includes("LEGACY_USER_TOKEN_A"), "stored encrypted");
  });

  await runTest("apply: Pages and Instagram accounts become resources and channels point at them", () => {
    for (const [ch, kind, tenant] of [[fbA, "FB_PAGE", A], [igA, "IG_ACCOUNT", A], [fbB, "FB_PAGE", B]] as const) {
      const now = db.data.connected_channels.find((c) => c.id === ch.id)!;
      const res = db.findConnectionResource(tenant, String(now.resource_id));
      assert.deepStrictEqual([res?.kind, res?.external_id, res?.status], [kind, ch.provider_account_id, "ACTIVE"], ch.id);
    }
    const fb = db.data.connected_channels.find((c) => c.id === fbA.id)!;
    assert.strictEqual(ChannelService.getDecryptedCredentials(fb).accessToken, "PAGE_TOKEN_A");
  });

  await runTest("apply: the copied user token is removed from the channel; the ad account is A's resource", () => {
    const fb = db.data.connected_channels.find((c) => c.id === fbA.id)!;
    const creds = ChannelService.getDecryptedCredentials(fb);
    assert.strictEqual(creds.adsToken, undefined);
    assert.strictEqual(creds.adsTokenOwner, undefined);
    const read = resolveMetaReadCredentials(A)!;
    assert.deepStrictEqual([read.adAccountId, read.adsToken, read.pageToken], ["77700011", "LEGACY_USER_TOKEN_A", "PAGE_TOKEN_A"]);
  });

  await runTest("apply: B's connection has no token, so it asks for sign-in; its Page still works", () => {
    const [conn] = db.getConnectors(B).filter((c) => c.auth_method === "oauth2");
    assert.strictEqual(conn.connection_status, "NEEDS_REAUTH");
    const fb = db.data.connected_channels.find((c) => c.id === fbB.id)!;
    assert.strictEqual(ChannelService.getDecryptedCredentials(fb).accessToken, "PAGE_TOKEN_B");
    assert.strictEqual(resolveMetaReadCredentials(B)?.adsToken ?? "", "");
  });

  await runTest("the pasted-token channel is left exactly as it was", () => {
    const now = db.data.connected_channels.find((c) => c.id === manualB.id)!;
    assert.strictEqual(now.resource_id, undefined);
    assert.strictEqual(now.credentials_encrypted, manualB.credentials_encrypted);
  });

  await runTest("running it again changes nothing", () => {
    const before = snapshot();
    const report = migrateChannelsToConnections(true);
    assert.strictEqual(report.migrated, 0);
    assert.strictEqual(snapshot(), before);
  });

  await runTest("a Page another workspace already holds as a resource is skipped, not taken over; its copied token is removed", () => {
    const dup = channel(C, "FACEBOOK_MESSENGER", "2001", {
      accessToken: "PAGE_TOKEN_C",
      pageId: "2001",
      connectedVia: "facebook_login",
      connectedBy: regC.user.id,
      adsToken: "LEGACY_USER_TOKEN_C",
      adsTokenOwner: regC.user.id,
    });
    const report = migrateChannelsToConnections(true);
    assert.strictEqual(report.migrated, 0);
    assert.ok(report.lines.some((l) => l.includes("held by another workspace")));
    const after = db.data.connected_channels.find((c) => c.id === dup.id)!;
    assert.strictEqual(after.resource_id, undefined);
    assert.strictEqual(ChannelService.getDecryptedCredentials(after).adsToken, undefined);
    assert.deepStrictEqual(db.findLiveConnectionResourcesByExternalId("FB_PAGE", "2001").map((r) => r.tenant_id), [A]);
  });

  await runTest("an owner who isn't a member of the workspace is not trusted, and their token isn't moved", () => {
    const D = regC.tenant.id;
    channel(D, "FACEBOOK_MESSENGER", "5001", {
      accessToken: "PAGE_TOKEN_D",
      pageId: "5001",
      connectedVia: "facebook_login",
      connectedBy: regA.user.id, // a user of another workspace
      adsToken: "FORGED_TOKEN",
      adsTokenOwner: regA.user.id,
    });
    const report = migrateChannelsToConnections(true);
    assert.strictEqual(report.migrated, 1);
    const conns = db.getConnectors(D).filter((c) => c.auth_method === "oauth2");
    assert.strictEqual(conns.length, 1);
    assert.deepStrictEqual([conns[0].owner_user_id, conns[0].connection_status], [undefined, "NEEDS_REAUTH"]);
  });

  await runTest("a channel naming another workspace's connection is not attached to it", () => {
    const [connA] = db.getConnectors(A).filter((c) => c.auth_method === "oauth2");
    const beforeA = JSON.stringify(db.getConnectionResources(A));
    const ch = channel(B, "INSTAGRAM", "1784009", {
      accessToken: "PAGE_TOKEN_B2",
      pageId: "3001",
      connectedVia: "facebook_login",
      connectedBy: regB.user.id,
      adsConnectionId: connA.id,
    });
    migrateChannelsToConnections(true);
    const res = db.findConnectionResource(B, String(db.data.connected_channels.find((c) => c.id === ch.id)?.resource_id));
    assert.ok(res && res.connection_id !== connA.id && db.findConnectorById(B, res.connection_id));
    assert.strictEqual(JSON.stringify(db.getConnectionResources(A)), beforeA);
  });

  console.log(`\n${ANSI_BOLD}Results: ${passedCount} passed, ${failedCount} failed${ANSI_RESET}\n`);
  if (failedCount > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
