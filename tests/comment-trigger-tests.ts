// @ts-ignore
import assert from "assert";
import crypto from "crypto";
declare const process: { exit(code?: number): void; env: Record<string, string | undefined> };
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { WebhookIngressService } from "@/domains/social/webhooks/webhook-ingress.service";
import {
  CommentTriggerCreateSchema,
  CommentTriggerService,
  dispatchCommentTriggersOnce,
  matchKeyword,
  parseMetaComments,
  renderOffer,
  setCommentTriggerAutoDispatchForTesting,
} from "@/domains/social/comment-triggers/comment-trigger.service";
import { setOutboundTransportForTesting } from "@/lib/outbound-http";
import { encryptCredential } from "@/lib/security";
import { parseOrThrow } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/permissions";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { RequestContext } from "@/lib/context";
import type { ChannelType } from "@/types/social";

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

const hmacHex = (secret: string, payload: string) => crypto.createHmac("sha256", secret).update(payload).digest("hex");

function contextFor(reg: Awaited<ReturnType<typeof AuthService.registerTenantWithOwner>>, permissions = Object.values(PERMISSIONS)): RequestContext {
  return {
    requestId: `req_${crypto.randomUUID().slice(0, 8)}`,
    traceId: `trc_${crypto.randomUUID().slice(0, 8)}`,
    user: { id: reg.user.id, email: reg.user.email, name: reg.user.name, status: "ACTIVE" },
    tenant: {
      id: reg.tenant.id,
      name: reg.tenant.name,
      slug: reg.tenant.slug,
      currency: "BDT",
      timezone: "Asia/Dhaka",
      language: "en",
      status: "ACTIVE",
    },
    role: "OWNER",
    permissions,
    timestamp: new Date().toISOString(),
  };
}

function fbCommentPayload(pageId: string, c: { commentId: string; postId?: string; fromId: string; name?: string; message: string }): string {
  return JSON.stringify({
    object: "page",
    entry: [
      {
        id: pageId,
        time: Date.now(),
        changes: [
          {
            field: "feed",
            value: {
              item: "comment",
              verb: "add",
              comment_id: c.commentId,
              post_id: c.postId ?? `${pageId}_post1`,
              parent_id: c.postId ?? `${pageId}_post1`,
              message: c.message,
              from: { id: c.fromId, name: c.name ?? "Rahim Uddin" },
              created_time: Math.floor(Date.now() / 1000),
            },
          },
        ],
      },
    ],
  });
}

async function main() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   COMMENT → INBOX TRIGGER SUITE                     ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  db.clearAllForTesting();
  setCommentTriggerAutoDispatchForTesting(false);

  const stamp = Date.now();
  const regA = await AuthService.registerTenantWithOwner({ workspaceName: `Comment Shop A ${stamp}`, name: "Owner A", email: `ct-a-${stamp}@example.com`, password: "Password12345!" });
  const regB = await AuthService.registerTenantWithOwner({ workspaceName: `Comment Shop B ${stamp}`, name: "Owner B", email: `ct-b-${stamp}@example.com`, password: "Password12345!" });
  const ctxA = contextFor(regA);
  const ctxB = contextFor(regB);

  const appSecret = crypto.randomBytes(24).toString("hex");
  process.env.META_APP_SECRET = appSecret;
  const pageA = `page_ct_${crypto.randomUUID().slice(0, 8)}`;
  const addChannel = (tenantId: string, type: ChannelType, providerAccountId: string, credentials: Record<string, unknown>) => {
    const now = new Date().toISOString();
    return db.createConnectedChannel({
      id: `chn_ct_${crypto.randomUUID().slice(0, 8)}`,
      tenant_id: tenantId,
      type,
      name: `Comment ${type}`,
      status: "ACTIVE",
      provider_account_id: providerAccountId,
      credentials_encrypted: encryptCredential(credentials),
      configuration: { auto_reply_enabled: false },
      created_at: now,
      updated_at: now,
    });
  };
  const channelA = addChannel(regA.tenant.id, "FACEBOOK_MESSENGER", pageA, { accessToken: "test-page-token" });
  const ingest = (payload: string) => WebhookIngressService.handleWebhook("FACEBOOK_MESSENGER", payload, `sha256=${hmacHex(appSecret, payload)}`, {});
  const eventsA = () => db.getCommentTriggerEvents(regA.tenant.id, 200);

  console.log(`${ANSI_BOLD}[Matching]${ANSI_RESET}`);

  await runTest("keywords match whole words and phrases, any case, ignoring punctuation", () => {
    assert.strictEqual(matchKeyword(["price"], "PRICE??"), "price");
    assert.strictEqual(matchKeyword(["price"], "what's the price of this?"), "price");
    assert.strictEqual(matchKeyword(["price"], "priceless"), undefined);
    assert.strictEqual(matchKeyword(["how much"], "Apu, how   much?"), "how much");
    assert.strictEqual(matchKeyword(["দাম"], "দাম কত?"), "দাম");
    assert.strictEqual(matchKeyword(["দাম"], "দামি"), undefined, "a Bangla keyword must not match inside a longer word");
  });

  await runTest("the offer fills {name} and {keyword} and tidies a missing name", () => {
    assert.strictEqual(renderOffer("Hi {name}! You asked about {keyword}.", { name: "Rahim", keyword: "price" }), "Hi Rahim! You asked about price.");
    assert.strictEqual(renderOffer("Hi {name}! Code EID15", { keyword: "price" }), "Hi! Code EID15");
  });

  await runTest("Instagram comment webhooks are parsed; the account's own comments are ignored", () => {
    const parsed = parseMetaComments("INSTAGRAM", {
      object: "instagram",
      entry: [
        {
          id: "ig_biz_1",
          changes: [
            { field: "comments", value: { id: "c1", text: "price?", from: { id: "u1", username: "rina" }, media: { id: "m1" } } },
            { field: "comments", value: { id: "c2", text: "thanks!", from: { id: "ig_biz_1", username: "shop" }, media: { id: "m1" } } },
          ],
        },
      ],
    });
    assert.strictEqual(parsed.length, 1);
    assert.deepStrictEqual([parsed[0].commentId, parsed[0].postId, parsed[0].commenterName], ["c1", "m1", "rina"]);
  });

  console.log(`\n${ANSI_BOLD}[Rules: validation, RBAC, tenant isolation]${ANSI_RESET}`);

  let ruleId = "";
  await runTest("a merchant creates a trigger; keywords are normalized and de-duplicated", () => {
    const input = parseOrThrow(CommentTriggerCreateSchema, {
      name: "Eid offer",
      keywords: ["Price", "price!", "দাম"],
      channel_types: ["FACEBOOK_MESSENGER"],
      dm_message: "Hi {name}! 15% off with code EID15.",
    });
    const rule = CommentTriggerService.create(ctxA, input);
    ruleId = rule.id;
    assert.deepStrictEqual(rule.keywords, ["price", "দাম"]);
    assert.strictEqual(rule.tenant_id, regA.tenant.id);
    assert.strictEqual(rule.is_active, true);
  });

  await runTest("unknown body fields (tenant_id, id) are rejected", () => {
    assert.throws(() =>
      parseOrThrow(CommentTriggerCreateSchema, {
        name: "x", keywords: ["a"], channel_types: ["INSTAGRAM"], dm_message: "y", tenant_id: regB.tenant.id,
      })
    );
  });

  await runTest("a role without social.template.manage cannot create triggers", () => {
    const readOnly = contextFor(regA, [PERMISSIONS.SOCIAL_TEMPLATE_READ]);
    assert.throws(
      () => CommentTriggerService.create(readOnly, { name: "x", keywords: ["a"], channel_types: ["INSTAGRAM"], dm_message: "y", post_ids: [], is_active: true }),
      ForbiddenError
    );
    assert.strictEqual(CommentTriggerService.list(readOnly).length, 1, "read access still lists them");
  });

  await runTest("template.manage without social.message.send can pause a trigger but not create, activate or reword one", () => {
    const noSend = contextFor(regA, [PERMISSIONS.SOCIAL_TEMPLATE_READ, PERMISSIONS.SOCIAL_TEMPLATE_MANAGE]);
    assert.throws(
      () => CommentTriggerService.create(noSend, { name: "x", keywords: ["a"], channel_types: ["INSTAGRAM"], dm_message: "y", post_ids: [], is_active: true }),
      ForbiddenError
    );
    assert.throws(() => CommentTriggerService.update(noSend, ruleId, { dm_message: "new text" }), ForbiddenError);
    assert.throws(() => CommentTriggerService.update(noSend, ruleId, { is_active: true }), ForbiddenError);
    CommentTriggerService.update(noSend, ruleId, { is_active: false });
    CommentTriggerService.update(ctxA, ruleId, { is_active: true });
  });

  await runTest("a crafted commenter name can't splice the template ($& / $` patterns are literal)", () => {
    assert.strictEqual(renderOffer("Hi {name}!", { name: "$&$`", keyword: "k" }), "Hi $&$`!");
  });

  await runTest("another workspace can neither see, edit nor delete the trigger", () => {
    assert.strictEqual(CommentTriggerService.list(ctxB).length, 0);
    assert.throws(() => CommentTriggerService.update(ctxB, ruleId, { is_active: false }), NotFoundError);
    assert.throws(() => CommentTriggerService.remove(ctxB, ruleId), NotFoundError);
    assert.strictEqual(db.findCommentTriggerRule(regA.tenant.id, ruleId)?.is_active, true);
  });

  console.log(`\n${ANSI_BOLD}[Webhook → queued inbox message]${ANSI_RESET}`);

  await runTest("a signed comment with a keyword queues one inbox message for the page's workspace", async () => {
    const result = await ingest(fbCommentPayload(pageA, { commentId: "post1_c1", fromId: "user_1", message: "Dam koto? PRICE please" }));
    assert.strictEqual(result.commentTriggersQueued, 1);
    const [event] = eventsA();
    assert.strictEqual(event.status, "PENDING");
    assert.strictEqual(event.comment_id, "post1_c1");
    assert.strictEqual(event.matched_keyword, "price");
    assert.strictEqual(event.message_text, "Hi Rahim Uddin! 15% off with code EID15.");
    assert.strictEqual(db.getCommentTriggerEvents(regB.tenant.id, 10).length, 0);
  });

  await runTest("a redelivered comment, a non-matching comment and the Page's own comment queue nothing", async () => {
    await ingest(fbCommentPayload(pageA, { commentId: "post1_c1", fromId: "user_1", message: "Dam koto? PRICE please" }));
    await ingest(fbCommentPayload(pageA, { commentId: "post1_c2", fromId: "user_2", message: "Beautiful colour" }));
    await ingest(fbCommentPayload(pageA, { commentId: "post1_c3", fromId: pageA, message: "Check your inbox for the price" }));
    assert.strictEqual(eventsA().length, 1);
  });

  await runTest("an unsigned comment webhook is rejected", async () => {
    const payload = fbCommentPayload(pageA, { commentId: "post1_c9", fromId: "user_9", message: "price" });
    await assert.rejects(() => WebhookIngressService.handleWebhook("FACEBOOK_MESSENGER", payload, "sha256=00", {}));
    assert.ok(!eventsA().some((e) => e.comment_id === "post1_c9"));
  });

  console.log(`\n${ANSI_BOLD}[Sending]${ANSI_RESET}`);

  await runTest("the worker sends a Meta private reply by comment id and records Meta's message id", async () => {
    let sentBody: Record<string, unknown> = {};
    let sentUrl = "";
    setOutboundTransportForTesting(async (url, options) => {
      sentUrl = url.toString();
      sentBody = JSON.parse(String(options.body || "{}"));
      return { status: 200, headers: {}, body: JSON.stringify({ recipient_id: "psid_77", message_id: "m_abc" }), truncated: false, durationMs: 2 };
    });
    try {
      const stats = await dispatchCommentTriggersOnce();
      assert.strictEqual(stats.sent, 1);
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.ok(sentUrl.endsWith("/me/messages"));
    assert.deepStrictEqual(sentBody.recipient, { comment_id: "post1_c1" });
    const [event] = eventsA();
    assert.strictEqual(event.status, "SENT");
    assert.strictEqual(event.external_message_id, "m_abc");
    assert.strictEqual(event.recipient_id, "psid_77");
  });

  await runTest("the same person spamming the keyword on the same post gets one message and adds no rows", async () => {
    const before = eventsA().length;
    for (let i = 0; i < 600; i++) {
      await ingest(fbCommentPayload(pageA, { commentId: `post1_spam_${i}`, fromId: "user_1", message: "price??" }));
    }
    assert.strictEqual(eventsA().length, before);
  });

  await runTest("a transient Meta failure is retried later, not reported as sent", async () => {
    await ingest(fbCommentPayload(pageA, { commentId: "post1_c5", fromId: "user_5", message: "price" }));
    setOutboundTransportForTesting(async () => ({ status: 500, headers: {}, body: JSON.stringify({ error: { code: 2, message: "temporary" } }), truncated: false, durationMs: 2 }));
    try {
      const stats = await dispatchCommentTriggersOnce();
      assert.strictEqual(stats.retrying, 1);
    } finally {
      setOutboundTransportForTesting(null);
    }
    const event = eventsA().find((e) => e.comment_id === "post1_c5");
    assert.strictEqual(event?.status, "PENDING");
    assert.ok(event!.next_attempt_at > new Date().toISOString(), "the retry waits");
    assert.strictEqual(event?.external_message_id, undefined);
  });

  await runTest("with real messaging switched off nothing is sent and the event says why", async () => {
    await ingest(fbCommentPayload(pageA, { commentId: "post1_c6", fromId: "user_6", message: "price" }));
    const now = new Date().toISOString();
    db.savePlatformFeatureFlag({ id: "ff_real_messaging_ct", key: "real_messaging", description: "test", is_enabled_globally: false, percentage_rollout: 0, scope: "GLOBAL", tenant_allowlist: [], rules: {}, created_at: now, updated_at: now });
    let calls = 0;
    setOutboundTransportForTesting(async () => {
      calls++;
      return { status: 200, headers: {}, body: "{}", truncated: false, durationMs: 1 };
    });
    try {
      await dispatchCommentTriggersOnce();
    } finally {
      setOutboundTransportForTesting(null);
      db.data.platform_feature_flags = db.data.platform_feature_flags.filter((f) => f.key !== "real_messaging");
    }
    const event = eventsA().find((e) => e.comment_id === "post1_c6");
    assert.strictEqual(calls, 0);
    assert.strictEqual(event?.status, "FAILED");
    assert.ok(event?.failure_reason?.includes("Nothing was sent"));
  });

  await runTest("a channel without a page token fails truthfully without calling Meta", async () => {
    const pageC = `page_ct_${crypto.randomUUID().slice(0, 8)}`;
    addChannel(regA.tenant.id, "FACEBOOK_MESSENGER", pageC, {});
    await ingest(fbCommentPayload(pageC, { commentId: "postC_c1", postId: `${pageC}_postC`, fromId: "user_c", message: "price" }));
    let calls = 0;
    setOutboundTransportForTesting(async () => {
      calls++;
      return { status: 200, headers: {}, body: "{}", truncated: false, durationMs: 1 };
    });
    try {
      await dispatchCommentTriggersOnce();
    } finally {
      setOutboundTransportForTesting(null);
    }
    const event = eventsA().find((e) => e.comment_id === "postC_c1");
    assert.strictEqual(calls, 0);
    assert.strictEqual(event?.status, "FAILED");
  });

  await runTest("a suspended workspace queues nothing and pending messages are not sent", async () => {
    await ingest(fbCommentPayload(pageA, { commentId: "post1_c8", fromId: "user_8", message: "price" }));
    db.updateTenant(regA.tenant.id, { status: "SUSPENDED" });
    let calls = 0;
    setOutboundTransportForTesting(async () => {
      calls++;
      return { status: 200, headers: {}, body: JSON.stringify({ message_id: "m_x" }), truncated: false, durationMs: 1 };
    });
    try {
      const result = await ingest(fbCommentPayload(pageA, { commentId: "post1_c10", fromId: "user_10", message: "price" }));
      assert.strictEqual(result.commentTriggersQueued, 0);
      await dispatchCommentTriggersOnce();
    } finally {
      setOutboundTransportForTesting(null);
      db.updateTenant(regA.tenant.id, { status: "ACTIVE" });
    }
    assert.strictEqual(calls, 0);
    assert.strictEqual(eventsA().find((e) => e.comment_id === "post1_c8")?.status, "FAILED");
  });

  await runTest("an outcome from a worker that lost its claim doesn't overwrite the event", async () => {
    await ingest(fbCommentPayload(pageA, { commentId: "post1_c11", fromId: "user_11", message: "price" }));
    const id = eventsA().find((e) => e.comment_id === "post1_c11")!.id;
    setOutboundTransportForTesting(async () => {
      // Another server reclaims and finishes while this send is in flight
      const current = db.findCommentTriggerEvent(regA.tenant.id, id)!;
      db.saveCommentTriggerEvent({ ...current, status: "SENT", external_message_id: "m_other", claimed_at: undefined });
      return { status: 500, headers: {}, body: JSON.stringify({ error: { code: 2, message: "temporary" } }), truncated: false, durationMs: 1 };
    });
    try {
      await dispatchCommentTriggersOnce();
    } finally {
      setOutboundTransportForTesting(null);
    }
    const event = db.findCommentTriggerEvent(regA.tenant.id, id)!;
    assert.strictEqual(event.status, "SENT");
    assert.strictEqual(event.external_message_id, "m_other");
  });

  await runTest("a paused trigger queues nothing", async () => {
    CommentTriggerService.update(ctxA, ruleId, { is_active: false });
    const result = await ingest(fbCommentPayload(pageA, { commentId: "post1_c7", fromId: "user_7", message: "price" }));
    assert.strictEqual(result.commentTriggersQueued, 0);
    assert.ok(!eventsA().some((e) => e.comment_id === "post1_c7"));
    assert.strictEqual(channelA.tenant_id, regA.tenant.id);
  });

  console.log(`\n${ANSI_BOLD}Results: ${passedCount} passed, ${failedCount} failed${ANSI_RESET}\n`);
  if (failedCount > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
