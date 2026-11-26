/**
 * The inbox list (GET /api/v1/social/conversations?view=inbox): which queue a chat is in, the counts, the order, message
 * previews, owners and tenant isolation, and that the page's actions send the fields their routes read.
 */
import assert from "assert";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { ConversationService } from "@/domains/social/conversations/conversation.service";
import { isCurrentHandoff, queueOf, replyDue, waitingSince, type InboxConversation, type InboxMeta } from "@/domains/social/conversations/inbox-queue";
import { AUTONOMOUS_FLAG, SHADOW_FLAG, agentMode } from "@/domains/ai/customer-agent/jobs";
import { PERMISSIONS, ROLE_PERMISSIONS } from "@/lib/permissions";
import { controlOf } from "@/domains/social/conversations/conversation-control.state";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { SocialOrderService } from "@/domains/social/commerce-integration/social-order.service";
import { CustomerService } from "@/domains/customers/customer.service";
import { ProductService } from "@/domains/catalog/product.service";
import type { RequestContext } from "@/lib/context";
import type { ChannelType, Conversation, ConversationControlState, Message } from "@/types/social";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
let passed = 0;
let failed = 0;
async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ${GREEN}✓ PASS${RESET} - ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ${RED}✗ FAIL${RESET} - ${name}`);
    console.error(err);
    failed++;
  }
}

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

interface Seed {
  id: string;
  state: ConversationControlState;
  channel?: ChannelType;
  status?: Conversation["status"];
  owner?: string;
  assigned?: string;
  minutes: number;
  card?: { created: number; due: number };
  customer_id?: string;
}

function conversation(tenantId: string, s: Seed): Conversation {
  const channel = s.channel ?? "WHATSAPP";
  return {
    id: s.id, tenant_id: tenantId, channel_id: `chn_${channel}`, channel_type: channel, customer_id: s.customer_id ?? "",
    external_conversation_id: `ext_${s.id}`, status: s.status ?? "OPEN", priority: "NORMAL", mode: s.state === "BOT" ? "AI" : "HUMAN",
    automation_paused: s.state !== "BOT",
    control: { state: s.state, version: 1, reason: "test", changed_by: "system:test", changed_at: ago(s.card?.created ?? s.minutes), ...(s.owner ? { owner_user_id: s.owner } : {}) },
    ...(s.assigned ? { assigned_user_id: s.assigned } : {}),
    last_message_at: ago(s.minutes), last_inbound_at: ago(s.minutes), unread_count: 0, tags: [], source: "OTHER",
    metadata: s.card ? { handoff_card: { reason: "x", summary: "y", created_at: ago(s.card.created), sla_due_at: ago(s.card.due) } } : {},
    created_at: ago(500), updated_at: ago(s.minutes),
  };
}

function message(tenantId: string, conversationId: string, id: string, minutes: number, extra: Partial<Message>): Message {
  return {
    id, tenant_id: tenantId, conversation_id: conversationId, direction: "INBOUND", sender_type: "CUSTOMER", message_type: "TEXT", text: id,
    status: "RECEIVED", retry_count: 0, metadata: {}, created_at: ago(minutes), updated_at: ago(minutes), ...extra,
  };
}

async function main() {
  console.log("\nInbox list\n");
  db.clearAllForTesting();
  const password = `Inbox-${crypto.randomUUID()}-Aa1!`;
  const register = (name: string) =>
    AuthService.registerTenantWithOwner({ email: `${name}_${crypto.randomUUID().slice(0, 8)}@inbox.test`, password, name: `${name} Owner`, workspaceName: `${name} shop` });
  const shop = await register("Alpha");
  const other = await register("Beta");
  const tenantId = shop.tenant.id;

  const context = (reg: typeof shop, permissions: RequestContext["permissions"] = Object.values(PERMISSIONS)): RequestContext => ({
    requestId: "req_inbox", traceId: "trc_inbox",
    user: { id: reg.user.id, email: reg.user.email, name: reg.user.name, status: "ACTIVE" },
    tenant: { id: reg.tenant.id, name: reg.tenant.name, slug: reg.tenant.slug, currency: "BDT", timezone: "Asia/Dhaka", language: "en", status: "ACTIVE" },
    role: "OWNER", permissions, timestamp: new Date(NOW).toISOString(),
  });
  const ctx = context(shop);

  const flag = (key: string, on: boolean) =>
    db.savePlatformFeatureFlag({
      id: `ff_${key}`, key, description: key, is_enabled_globally: false, percentage_rollout: 100, scope: "TENANT",
      tenant_allowlist: on ? [tenantId] : [], rules: {}, created_at: ago(0), updated_at: ago(0),
    } as never);

  // A colleague who is a member of this workspace
  const colleagueId = `usr_${crypto.randomUUID().slice(0, 8)}`;
  db.createUser({ ...db.findUserById(shop.user.id)!, id: colleagueId, email: `${colleagueId}@inbox.test`, name: "Rafi Colleague" });
  db.createMembership({ ...db.findMembership(tenantId, shop.user.id)!, id: `mbr_${colleagueId}`, user_id: colleagueId });

  // Seeded chats, if any, would change the counts
  for (const c of db.getAllConversations(tenantId)) db.data.conversations.splice(db.data.conversations.indexOf(c), 1);
  const seeds: Seed[] = [
    { id: "ib_due_late", state: "ESCALATED", minutes: 5, card: { created: 40, due: -20 } },
    { id: "ib_due_first", state: "ESCALATED", minutes: 90, card: { created: 90, due: 30 } },
    { id: "ib_agent", state: "BOT", minutes: 2 },
    { id: "ib_agent_ig", state: "BOT", channel: "INSTAGRAM", minutes: 3 },
    { id: "ib_mine", state: "HUMAN", owner: shop.user.id, minutes: 10 },
    { id: "ib_colleague", state: "HUMAN", owner: colleagueId, minutes: 11 },
    { id: "ib_stranger", state: "HUMAN", owner: other.user.id, minutes: 12 },
    { id: "ib_done", state: "ESCALATED", status: "RESOLVED", minutes: 1, card: { created: 400, due: 390 } },
  ];
  for (const s of seeds) db.createConversation(conversation(tenantId, s));
  db.createConversation(conversation(other.tenant.id, { id: "ib_other_tenant", state: "ESCALATED", minutes: 1 }));
  db.createMessage(message(tenantId, "ib_agent", "ib_m1", 9, { text: "Dam koto?" }));
  db.createMessage(message(tenantId, "ib_agent", "ib_m2", 8, { text: "৳1,850", direction: "OUTBOUND", sender_type: "BOT", status: "SENT" }));
  db.createMessage(message(tenantId, "ib_agent", "ib_m3", 1, { text: "secret team note", direction: "OUTBOUND", sender_type: "AGENT", message_type: "INTERNAL_NOTE" }));
  db.createMessage(message(other.tenant.id, "ib_other_tenant", "ib_m4", 0, { text: "another shop" }));

  const list = (options: Parameters<typeof ConversationService.listInbox>[1] = {}, c = ctx) => ConversationService.listInbox(c, options);
  const ids = (r: { conversations: InboxConversation[] }) => r.conversations.map((x) => x.id);

  await runTest("queues follow the chat's control and status; with the agent off, its chats need a person", () => {
    const c = (s: Partial<Seed>) => conversation(tenantId, { id: "x", state: "BOT", minutes: 1, ...s });
    assert.strictEqual(queueOf(c({}), true), "AGENT");
    assert.strictEqual(queueOf(c({}), false), "NEEDS_PERSON");
    assert.strictEqual(queueOf(c({ state: "ESCALATED" }), true), "NEEDS_PERSON");
    assert.strictEqual(queueOf(c({ state: "HUMAN" }), true), "TEAM");
    for (const status of ["RESOLVED", "CLOSED", "SPAM"] as const) assert.strictEqual(queueOf(c({ state: "ESCALATED", status }), true), "DONE");
    // A card left over from an earlier handoff sets no reply time and no waiting time once the agent has the chat again
    const back = c({ state: "BOT", card: { created: 300, due: 240 } });
    assert.strictEqual(replyDue(back), undefined);
    assert.strictEqual(waitingSince(back), back.last_inbound_at);
  });

  flag(AUTONOMOUS_FLAG, false); // the seeded flag is on
  flag(SHADOW_FLAG, false);

  await runTest("agent off: nothing is reported as answered by the agent", async () => {
    assert.strictEqual(agentMode(tenantId), "OFF");
    const { meta, conversations } = await list({ queue: "OPEN" });
    assert.strictEqual(meta.agent_mode, "OFF");
    assert.strictEqual(meta.queues.AGENT, 0);
    assert.strictEqual(meta.queues.NEEDS_PERSON, 4);
    assert.ok(conversations.every((c) => !c.agent_answers));
  });

  await runTest("shadow mode: the agent drafts but doesn't answer, so its chats still need a person", async () => {
    flag(SHADOW_FLAG, true);
    try {
      const { meta } = await list();
      assert.strictEqual(meta.agent_mode, "SHADOW");
      assert.strictEqual(meta.queues.AGENT, 0);
    } finally {
      flag(SHADOW_FLAG, false);
    }
  });

  flag(AUTONOMOUS_FLAG, true);

  await runTest("counts cover every chat of the workspace, not the page", async () => {
    const { meta, conversations } = await list({ queue: "OPEN", limit: 1 });
    assert.strictEqual(conversations.length, 1);
    assert.strictEqual(meta.total, 7);
    const { oldest_waiting_since, ...counts } = meta.queues;
    assert.deepStrictEqual(counts, { NEEDS_PERSON: 2, AGENT: 2, TEAM: 3, DONE: 1, mine: 1 });
    assert.strictEqual(oldest_waiting_since, ago(90));
    assert.deepStrictEqual(meta.channels, { WHATSAPP: 6, INSTAGRAM: 1 });
    assert.strictEqual(meta.viewer_id, shop.user.id);
  });

  await runTest("order: needs a person first by reply due, then the agent's and the team's chats by newest message", async () => {
    assert.deepStrictEqual(ids(await list({ queue: "OPEN" })), ["ib_due_first", "ib_due_late", "ib_agent", "ib_agent_ig", "ib_mine", "ib_colleague", "ib_stranger"]);
    assert.deepStrictEqual(ids(await list({ queue: "DONE" })), ["ib_done"]);
    assert.deepStrictEqual(ids(await list({ queue: "AGENT", channel_type: "INSTAGRAM" })), ["ib_agent_ig"]);
  });

  await runTest("a channel the workspace's AI policy leaves out needs a person", async () => {
    const policy = db.getAIPolicy(tenantId);
    db.setAIPolicy({ ...policy, allowed_channel_types: ["WHATSAPP"] });
    try {
      const { conversations } = await list({ queue: "OPEN" });
      assert.strictEqual(conversations.find((c) => c.id === "ib_agent_ig")?.queue, "NEEDS_PERSON");
      assert.strictEqual(conversations.find((c) => c.id === "ib_agent")?.queue, "AGENT");
    } finally {
      db.setAIPolicy(policy);
    }
  });

  await runTest("preview: the newest message that isn't a team note, from this workspace only", async () => {
    const row = (await list({ queue: "AGENT" })).conversations.find((c) => c.id === "ib_agent");
    assert.strictEqual(row?.last_message?.text, "৳1,850");
    assert.strictEqual(row?.last_message?.is_ai, true);
    assert.strictEqual(row?.last_message?.direction, "OUTBOUND");
    assert.strictEqual((await list({ queue: "TEAM" })).conversations[0].last_message, undefined);
  });

  await runTest("owner: named for members of this workspace; a user of another one is never named", async () => {
    const rows = (await list({ queue: "TEAM" })).conversations;
    assert.deepStrictEqual(rows.find((c) => c.id === "ib_colleague")?.owner, { id: colleagueId, name: "Rafi Colleague" });
    assert.strictEqual(rows.find((c) => c.id === "ib_mine")?.owner?.id, shop.user.id);
    assert.strictEqual(rows.find((c) => c.id === "ib_stranger")?.owner, undefined);
  });

  await runTest("an open ticket sets the reply time and carries the order draft; a resolved one doesn't", async () => {
    const items = [{ variant_id: "v1", product_name: "Panjabi", quantity: 3, unit_price: 1850, line_total: 5550 }];
    const ticket = {
      id: "hitl_ib", tenant_id: tenantId, conversation_id: "ib_ticket", trace_id: "t", customer_phone_masked: "x", priority: "NORMAL" as const,
      status: "PENDING_REVIEW" as const, trigger_reason: "asked for a discount", sla_due_at: ago(-5), created_at: ago(55), updated_at: ago(55),
      order_draft: { items, delivery_district: "Chattogram", subtotal: 5550, delivery_fee: 120, grand_total: 5670, payment_method: "COD" as const },
    };
    db.createConversation(conversation(tenantId, { id: "ib_ticket", state: "ESCALATED", minutes: 55 }));
    db.saveAgentHitlEscalation(ticket);
    const row = (await list({ queue: "NEEDS_PERSON" })).conversations.find((c) => c.id === "ib_ticket");
    assert.strictEqual(row?.escalation?.order_draft?.grand_total, 5670);
    assert.deepStrictEqual(row && replyDue(row), { from: ago(55), due: ago(-5) });
    db.saveAgentHitlEscalation({ ...ticket, status: "RESOLVED" });
    assert.strictEqual((await list({ queue: "NEEDS_PERSON" })).conversations.find((c) => c.id === "ib_ticket")?.escalation, undefined);
    db.updateConversation(tenantId, "ib_ticket", { status: "CLOSED" });
  });

  await runTest("message text and tickets need their own read permissions", async () => {
    db.createConversation(conversation(tenantId, { id: "ib_perm", state: "ESCALATED", minutes: 4 }));
    db.createMessage(message(tenantId, "ib_perm", "ib_perm_m", 4, { text: "x".repeat(400) }));
    db.saveAgentHitlEscalation({
      id: "hitl_perm", tenant_id: tenantId, conversation_id: "ib_perm", trace_id: "t", customer_phone_masked: "x", priority: "NORMAL", status: "PENDING_REVIEW",
      trigger_reason: "secret reason", sla_due_at: ago(-5), created_at: ago(4), updated_at: ago(4),
    });
    const full = (await list({ id: "ib_perm" })).conversations[0];
    assert.strictEqual(full.last_message?.text.length, 160);
    assert.strictEqual(full.escalation?.trigger_reason, "secret reason");
    const reader = await list({}, context(shop, [PERMISSIONS.SOCIAL_CONVERSATION_READ]));
    assert.ok(reader.conversations.length > 5);
    assert.ok(reader.conversations.every((c) => !c.last_message && !c.escalation));
    db.updateConversation(tenantId, "ib_perm", { status: "CLOSED" });
  });

  await runTest("a chat is assigned only to members of its workspace", async () => {
    await assert.rejects(ConversationService.assignConversation(ctx, "ib_agent_ig", other.user.id, "SALES"), BadRequestError);
    const assigned = await ConversationService.assignConversation(ctx, "ib_agent_ig", colleagueId, "SALES");
    assert.strictEqual(assigned.assigned_user_id, colleagueId);
    await ConversationService.assignConversation(ctx, "ib_agent_ig", undefined, undefined);
  });

  await runTest("Sales and Support staff take a chat over, hand it back, set its status and tags, and reopen it", async () => {
    for (const role of ["SALES", "SUPPORT"] as const) {
      const staff = { ...context(shop, ROLE_PERMISSIONS[role]), role };
      const id = `ib_role_${role}`;
      db.createConversation(conversation(tenantId, { id, state: "ESCALATED", minutes: 3 }));
      assert.strictEqual(controlOf(await ConversationService.setAutomationPaused(staff, id, true)).state, "HUMAN");
      assert.strictEqual((await ConversationService.addTag(staff, id, "vip")).tags.includes("VIP"), true);
      assert.strictEqual((await ConversationService.updateStatus(staff, id, "WAITING_CUSTOMER")).status, "WAITING_CUSTOMER");
      assert.strictEqual((await ConversationService.resolveConversation(staff, id)).status, "RESOLVED");
      assert.strictEqual((await ConversationService.reopenConversation(staff, id)).status, "OPEN");
      assert.strictEqual(controlOf(await ConversationService.setAutomationPaused(staff, id, false)).state, "BOT");
      db.updateConversation(tenantId, id, { status: "CLOSED" });
    }
    // Reading roles still can't
    await assert.rejects(ConversationService.setAutomationPaused({ ...context(shop, ROLE_PERMISSIONS.ANALYST), role: "ANALYST" }, "ib_role_SALES", true), ForbiddenError);
    await assert.rejects(ConversationService.setAutomationPaused({ ...context(shop, ROLE_PERMISSIONS.MARKETING), role: "MARKETING" }, "ib_role_SALES", true), ForbiddenError);
  });

  await runTest("resolving a chat closes its open escalation tickets, and only that chat's", async () => {
    const ticket = (id: string, conversationId: string, tenant = tenantId) => ({
      id, tenant_id: tenant, conversation_id: conversationId, trace_id: "t", customer_phone_masked: "x", priority: "NORMAL" as const,
      status: "PENDING_REVIEW" as const, trigger_reason: "needs a person", sla_due_at: ago(-5), created_at: ago(10), updated_at: ago(10),
    });
    db.createConversation(conversation(tenantId, { id: "ib_resolve", state: "ESCALATED", minutes: 10 }));
    db.createConversation(conversation(tenantId, { id: "ib_resolve_other", state: "ESCALATED", minutes: 10 }));
    db.saveAgentHitlEscalation(ticket("hitl_resolve", "ib_resolve"));
    db.saveAgentHitlEscalation({ ...ticket("hitl_resolve_claimed", "ib_resolve"), status: "CLAIMED" });
    db.saveAgentHitlEscalation(ticket("hitl_resolve_other", "ib_resolve_other"));
    assert.ok((await list({ queue: "NEEDS_PERSON" })).conversations.find((c) => c.id === "ib_resolve")?.escalation);

    await ConversationService.resolveConversation(ctx, "ib_resolve");
    for (const id of ["hitl_resolve", "hitl_resolve_claimed"]) {
      const closed = db.findAgentHitlEscalation(tenantId, id);
      assert.strictEqual(closed?.status, "RESOLVED");
      assert.strictEqual(closed?.resolution_type, "CHAT_RESOLVED");
      assert.ok(closed?.resolved_at);
    }
    assert.strictEqual(db.findAgentHitlEscalation(tenantId, "hitl_resolve_other")?.status, "PENDING_REVIEW");
    db.updateConversation(tenantId, "ib_resolve", { status: "CLOSED" });
    db.updateConversation(tenantId, "ib_resolve_other", { status: "CLOSED" });
  });

  await runTest("tenant isolation: another workspace's chats are in no list and no count", async () => {
    const mine = await list();
    assert.ok(!ids(mine).includes("ib_other_tenant"));
    const theirs = await list({}, context(other));
    assert.deepStrictEqual(ids(theirs), ["ib_other_tenant"]);
    assert.strictEqual(theirs.meta.queues.NEEDS_PERSON, 1);
    assert.strictEqual(theirs.meta.total, 1);
  });

  await runTest("without the read permission the list is refused", async () => {
    await assert.rejects(list({}, context(shop, [PERMISSIONS.SOCIAL_MESSAGE_SEND])), ForbiddenError);
  });

  const token = (await AuthService.login(shop.user.email, password, tenantId)).token;
  const { GET } = (await import("@/app/api/v1/social/conversations/route")) as { GET: (r: Request) => Promise<Response> };
  const call = (query: string, auth = true) =>
    GET(new NextRequest(`http://localhost:3000/api/v1/social/conversations${query}`, auth ? { headers: { authorization: `Bearer ${token}` } } : {}));

  await runTest("route: the inbox view answers with rows and counts, and reading it stores nothing", async () => {
    const before = JSON.stringify(db.data.conversations);
    const res = await call("?view=inbox&queue=OPEN");
    assert.strictEqual(res.status, 200, await res.clone().text());
    const body = (await res.json()) as { data: InboxConversation[]; meta: InboxMeta };
    assert.strictEqual(body.data[0].id, "ib_due_first");
    assert.strictEqual(body.meta.queues.TEAM, 3);
    assert.strictEqual(JSON.stringify(db.data.conversations), before);
  });

  await runTest("route: an unknown queue or limit is a 400, no session a 401, and the plain list is unchanged", async () => {
    assert.strictEqual((await call("?view=inbox&queue=EVERYTHING")).status, 400);
    assert.strictEqual((await call("?view=inbox&limit=100000")).status, 400);
    assert.strictEqual((await call("?view=inbox", false)).status, 401);
    const plain = (await (await call("")).json()) as { data: Array<Record<string, unknown>>; meta: Record<string, unknown> };
    assert.ok(plain.data.length > 0 && !("queue" in plain.data[0]) && !("queues" in plain.meta));
  });

  await runTest("one chat by its id: how the page keeps the open chat current", async () => {
    const body = (await (await call("?view=inbox&id=ib_done&limit=1")).json()) as { data: InboxConversation[] };
    assert.deepStrictEqual(body.data.map((c) => c.id), ["ib_done"]);
  });

  await runTest("the agent's draft becomes one order: a second confirm is refused, its tickets and quote are done", async () => {
    const product = await ProductService.createProduct(ctx, {
      name: "Draft panjabi", sku: "IB-PNJ", base_price: 1850, initial_stock: 20,
      variants: [{ title: "XL", sku: "IB-PNJ-XL", price: 1850, initial_stock: 20 }],
    });
    const variantId = product.variants[0].id;
    const customer = await CustomerService.createCustomer(ctx, { first_name: "Tasnim", last_name: "Rahman", phone: "01711223355" });
    db.createConversation(conversation(tenantId, { id: "ib_order", state: "ESCALATED", minutes: 10, customer_id: customer.id }));
    const draft = {
      items: [{ variant_id: variantId, product_name: "Draft panjabi", quantity: 2, unit_price: 1, line_total: 2 }],
      delivery_district: "Dhaka", subtotal: 2, delivery_fee: 0, grand_total: 2, payment_method: "COD" as const,
    };
    const ticket = (id: string, created: number) =>
      db.saveAgentHitlEscalation({
        id, tenant_id: tenantId, conversation_id: "ib_order", trace_id: "t", customer_phone_masked: "x", priority: "NORMAL", status: "PENDING_REVIEW",
        trigger_reason: "r", order_draft: draft, sla_due_at: ago(-5), created_at: ago(created), updated_at: ago(created),
      });
    ticket("hitl_old", 9);
    ticket("hitl_new", 6);
    db.createQuote({
      id: "quo_ib", tenant_id: tenantId, conversation_id: "ib_order", items: [{ variant_id: variantId, quantity: 2 }], district: "Dhaka", zone: "INSIDE_DHAKA",
      lines: [], subtotal: 2, discount_total: 0, delivery_charge: 0, grand_total: 2, customer_msg_count_at_quote: 1, status: "QUOTED", expires_at: ago(-60),
      created_at: ago(6), updated_at: ago(6),
    });
    const row = (await list({ id: "ib_order" })).conversations[0];
    assert.strictEqual(row.escalation?.id, "hitl_old", "the oldest ticket sets the reply time");
    assert.strictEqual(row.escalation?.draft_ticket_id, "hitl_new", "the newest draft is the one to review");

    // The agent places the quote itself: its draft is no longer offered, and confirming it is refused
    const quoteNow = new Date().toISOString();
    db.data.quotes.find((q) => q.id === "quo_ib")!.status = "PLACED";
    db.data.quotes.find((q) => q.id === "quo_ib")!.updated_at = quoteNow;
    const placed = (await list({ id: "ib_order" })).conversations[0];
    assert.strictEqual(placed.escalation?.order_draft, undefined);
    await assert.rejects(
      SocialOrderService.createOrderFromConversation(ctx, {
        conversation_id: "ib_order", escalation_id: "hitl_new", items: [{ variant_id: variantId, quantity: 2 }],
        delivery_address: { district: "Dhaka", address_line_1: "House 4, Road 2" }, payment_method: "COD",
      }),
      ConflictError
    );
    db.updateQuote(tenantId, "quo_ib", { status: "QUOTED" });

    const confirm = (c: RequestContext, escalation_id: string, conversation_id = "ib_order") =>
      SocialOrderService.createOrderFromConversation(c, {
        conversation_id, escalation_id, items: [{ variant_id: variantId, quantity: 2 }],
        delivery_address: { district: "Dhaka", address_line_1: "House 4, Road 2" }, payment_method: "COD",
      });
    await assert.rejects(confirm(context(shop, [PERMISSIONS.ORDERS_CREATE]), "hitl_new"), ForbiddenError);
    await assert.rejects(confirm(ctx, "hitl_new", "ib_agent"), NotFoundError, "a ticket of another chat");
    const before = db.getAllOrders(tenantId).length;
    const order = await confirm(ctx, "hitl_new");
    assert.ok(order.subtotal >= 3700, "priced by the server, not from the draft");
    await assert.rejects(confirm(ctx, "hitl_old"), ConflictError);
    await assert.rejects(confirm(ctx, "hitl_new"), ConflictError);
    assert.strictEqual(db.getAllOrders(tenantId).length, before + 1);
    for (const id of ["hitl_old", "hitl_new"]) assert.strictEqual(db.findAgentHitlEscalation(tenantId, id)?.resolution_type, "DRAFT_APPROVED");
    assert.strictEqual(db.findQuote(tenantId, "ib_order", "quo_ib")?.status, "STALE");
  });

  await runTest("a card or ticket of an earlier handoff says nothing about the next one", async () => {
    const chat = (state: ConversationControlState, changed: number, card: number) => ({
      ...conversation(tenantId, { id: "x", state, minutes: changed, card: { created: card, due: card - 15 } }),
      control: { state, version: 3, reason: "t", changed_by: "system:t", changed_at: ago(changed) },
    });
    assert.strictEqual(replyDue(chat("ESCALATED", 5, 60 * 24 * 30)), undefined, "a month-old card");
    assert.deepStrictEqual(replyDue(chat("ESCALATED", 5, 5))?.from, ago(5));
    const ticket = { id: "t", trigger_reason: "r", priority: "HIGH", created_at: ago(5), sla_due_at: ago(-10) };
    assert.strictEqual(replyDue({ ...chat("ESCALATED", 5, 60 * 24 * 30), escalation: ticket })?.due, ago(-10), "the ticket's time, not the old card's");
    assert.strictEqual(isCurrentHandoff(chat("HUMAN", 5, 30), ago(30)), true, "still shown after a person took it over");
    assert.strictEqual(isCurrentHandoff(chat("HUMAN", 5, 30), ago(60 * 24 * 3)), false);
    assert.strictEqual(isCurrentHandoff(chat("BOT", 5, 30), ago(4)), false);
  });

  await runTest("routes: assign takes a known team and a member only; a draft confirm needs its own open ticket", async () => {
    const post = async (mod: { POST: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response> }, url: string, id: string, body: unknown) =>
      (await mod.POST(new NextRequest(`http://localhost:3000/api/v1${url}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) })).status;
    const assignRoute = (await import("@/app/api/v1/social/conversations/[id]/assign/route")) as never;
    const assign = (body: unknown) => post(assignRoute, "/social/conversations/ib_agent_ig/assign", "ib_agent_ig", body);
    assert.strictEqual(await assign({ assigned_team_id: "FINANCE" }), 200);
    assert.strictEqual(db.findConversationById(tenantId, "ib_agent_ig")?.assigned_team_id, "FINANCE");
    assert.strictEqual(await assign({ assigned_team_id: "EVERYONE" }), 400);
    assert.strictEqual(await assign({ assigned_team: "FINANCE" }), 400, "an unknown field is refused, not ignored");
    assert.strictEqual(await assign({ assigned_user_id: other.user.id }), 400);
    const draftRoute = (await import("@/app/api/v1/social/orders/draft/route")) as never;
    const order = { conversation_id: "ib_order", items: [{ variant_id: "v", quantity: 1 }], delivery_address: { district: "Dhaka", address_line_1: "x" }, payment_method: "COD" };
    assert.strictEqual(await post(draftRoute, "/social/orders/draft", "", { ...order, escalation_id: "hitl_new" }), 409, "already handled");
    assert.strictEqual(await post(draftRoute, "/social/orders/draft", "", { ...order, escalation_id: "nope" }), 404);
  });

  await runTest("a team note stays a note when its chat is opened again (it must never become a reply)", () => {
    const page = fs.readFileSync(path.resolve(__dirname, "../src/app/(dashboard)/conversations/page.tsx"), "utf8");
    const composer = fs.readFileSync(path.resolve(__dirname, "../src/components/social/Composer.tsx"), "utf8");
    assert.ok(/Record<string, Draft>/.test(page) && !/useState\(false\);\s*\/\/ isNote/.test(composer));
    assert.ok(/const \{ text: draftText, isNote \} = draft;/.test(composer), "the kind is stored with the chat's text");
    assert.ok(/onDraft\(id, EMPTY_DRAFT\)/.test(composer), "the sent chat's box is cleared, not the open one's");
  });

  await runTest("the agent's draft carries variant ids, not SKUs (an order looks variants up by id)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../src/domains/ai/customer-agent/runtime.ts"), "utf8");
    assert.ok(/variant_id: openDraftQuote\.items\[i\]\?\.variant_id/.test(src));
  });

  await runTest("the page's actions send the fields their routes read (team, note and tag were silently lost before)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../src/components/social/useInbox.ts"), "utf8");
    const pageSrc = fs.readFileSync(path.resolve(__dirname, "../src/app/(dashboard)/conversations/page.tsx"), "utf8");
    assert.ok(/assigned_team_id: team/.test(src) && !/assigned_team:/.test(src + pageSrc));
    assert.ok(/"\/notes", \{ text \}/.test(src));
    assert.ok(/customer_id: active\.customer\.id/.test(src), "a lead needs its customer");
    assert.ok(!/lead_score|buying_intent/.test(src + pageSrc), "no invented lead score");
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
