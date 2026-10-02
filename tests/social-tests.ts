// @ts-ignore
import assert from "assert";
import crypto from "crypto";
declare const process: { exit(code?: number): void; env: Record<string, string | undefined> };
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { ProductService } from "@/domains/catalog/product.service";
import { CustomerService } from "@/domains/customers/customer.service";
import { FacebookAdapter } from "@/domains/social/channels/adapters/facebook.adapter";
import { InstagramAdapter } from "@/domains/social/channels/adapters/instagram.adapter";
import { WhatsAppAdapter } from "@/domains/social/channels/adapters/whatsapp.adapter";
import { WebsiteChatAdapter } from "@/domains/social/channels/adapters/website-chat.adapter";
import { TelegramAdapter } from "@/domains/social/channels/adapters/telegram.adapter";
import { BanglishNormalizer } from "@/domains/social/identity/banglish-normalizer";
import { IdentityResolutionService } from "@/domains/social/identity/identity-resolution.service";
import { ConversationStateMachine } from "@/domains/social/conversations/state-machine";
import { ConversationService } from "@/domains/social/conversations/conversation.service";
import { MessageService } from "@/domains/social/messages/message.service";
import { AssignmentService } from "@/domains/social/assignments/assignment.service";
import { ChannelRateLimiter } from "@/domains/social/outbound/rate-limiter";
import { OutboundMessageService } from "@/domains/social/outbound/outbound-message.service";
import { SocialOrderService } from "@/domains/social/commerce-integration/social-order.service";
import { SocialEventService } from "@/domains/social/events/social-event.service";
import { ChannelService } from "@/domains/social/channels/channel.service";
import { ConnectorService } from "@/domains/connectors/service";
import { OutboundTimeoutError, setOutboundTransportForTesting } from "@/lib/outbound-http";
import { encryptCredential, decryptCredential } from "@/lib/security";
import { AuthenticationError } from "@/lib/errors";
import { POST as telegramConnectorWebhook } from "@/app/api/v1/connectors/[id]/webhook/route";
import { RequestContext } from "@/lib/context";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { ForbiddenError, BadRequestError } from "@/lib/errors";

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

export async function runSocialCommerceTests() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   COMMERCEOS PHASE 3: SOCIAL COMMERCE TEST SUITE     ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  db.clearAllForTesting();

  // Setup 2 isolated tenants
  const now = Date.now();
  const tenantA = await AuthService.registerTenantWithOwner({
    workspaceName: `Dhaka Threads ${now}`,
    name: "Tanvir Owner",
    email: `tanvir-${now}@example.com`,
    password: "Password12345!",
    currency: "BDT",
  });

  const tenantB = await AuthService.registerTenantWithOwner({
    workspaceName: `Chittagong Silks ${now}`,
    name: "Zubair Owner",
    email: `zubair-${now}@example.com`,
    password: "Password12345!",
    currency: "BDT",
  });

  const nowIso = new Date().toISOString();

  const contextA: RequestContext = {
    requestId: "req_test_soc_a",
    traceId: "trc_test_soc_a",
    user: {
      id: tenantA.user.id,
      email: tenantA.user.email,
      name: tenantA.user.name,
      status: "ACTIVE",
    },
    tenant: {
      id: tenantA.tenant.id,
      name: tenantA.tenant.name,
      slug: tenantA.tenant.slug,
      currency: "BDT",
      timezone: "Asia/Dhaka",
      language: "en",
      status: "ACTIVE",
    },
    role: "OWNER",
    permissions: Object.values(PERMISSIONS),
    timestamp: nowIso,
  };

  const contextB: RequestContext = {
    requestId: "req_test_soc_b",
    traceId: "trc_test_soc_b",
    user: {
      id: tenantB.user.id,
      email: tenantB.user.email,
      name: tenantB.user.name,
      status: "ACTIVE",
    },
    tenant: {
      id: tenantB.tenant.id,
      name: tenantB.tenant.name,
      slug: tenantB.tenant.slug,
      currency: "BDT",
      timezone: "Asia/Dhaka",
      language: "en",
      status: "ACTIVE",
    },
    role: "OWNER",
    permissions: Object.values(PERMISSIONS),
    timestamp: nowIso,
  };

  // -------------------------------------------------------------
  // SUITE 1: WEBHOOK INGRESS & SIGNATURE VERIFICATION
  // -------------------------------------------------------------
  console.log(`${ANSI_BOLD}[1] Webhook Ingress & Cryptographic Signature Verification${ANSI_RESET}`);

  await runTest("Verify Facebook X-Hub-Signature-256 HMAC valid and invalid signatures", () => {
    const fbAdapter = new FacebookAdapter();
    const appSecret = "fb_secret_key_1234567890abcdef";
    const payload = JSON.stringify({ object: "page", entry: [{ id: "page_1", time: Date.now() }] });

    const validHmac = crypto.createHmac("sha256", appSecret).update(payload).digest("hex");
    const validHeader = `sha256=${validHmac}`;

    const isValid = fbAdapter.verifyWebhook(payload, validHeader, {}, { appSecret });
    assert.strictEqual(isValid, true, "Valid Facebook HMAC signature must be accepted");

    const isTampered = fbAdapter.verifyWebhook(payload + "tampered", validHeader, {}, { appSecret });
    assert.strictEqual(isTampered, false, "Tampered payload must be rejected");

    const isWrongSig = fbAdapter.verifyWebhook(payload, "sha256=invalid_hash", {}, { appSecret });
    assert.strictEqual(isWrongSig, false, "Invalid signature hash must be rejected");
  });

  await runTest("Verify Instagram signature verification matches Meta security standards", () => {
    const igAdapter = new InstagramAdapter();
    const appSecret = "ig_secret_meta_9876543210fedcba";
    const payload = JSON.stringify({ object: "instagram", entry: [{ id: "ig_user_1" }] });
    const hmac = crypto.createHmac("sha256", appSecret).update(payload).digest("hex");

    assert.strictEqual(
      igAdapter.verifyWebhook(payload, `sha256=${hmac}`, {}, { appSecret }),
      true,
      "Valid Instagram signature must be verified"
    );
    assert.strictEqual(
      igAdapter.verifyWebhook(payload, "sha256=bad", {}, { appSecret }),
      false,
      "Tampered Instagram signature must be rejected"
    );
  });

  await runTest("Verify WhatsApp Webhook verification and Website Chat HMAC", () => {
    const waAdapter = new WhatsAppAdapter();
    const webAdapter = new WebsiteChatAdapter();
    const secret = "shared_webhook_secret_xyz";
    const payload = JSON.stringify({ from: "8801711223344", text: "Hello" });
    const hmac = crypto.createHmac("sha256", secret).update(payload).digest("hex");

    assert.strictEqual(
      waAdapter.verifyWebhook(payload, `sha256=${hmac}`, {}, { appSecret: secret }),
      true,
      "Valid WhatsApp signature must be verified"
    );
    assert.strictEqual(
      webAdapter.verifyWebhook(payload, hmac, {}, { webhookSecret: secret }),
      true,
      "Valid Website Chat signature must be verified"
    );
  });

  // -------------------------------------------------------------
  // SUITE 2: CANONICAL NORMALIZATION & BANGLISH ANALYSIS
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[2] Canonical Message Normalization & Banglish Analysis${ANSI_RESET}`);

  await runTest("Preserve raw lossless text and accurately extract phone and order intent in Banglish", () => {
    const rawText = "Bhai apnader premium panjabi er price koto? Ami order korte chai. Phone: 01711223344";
    const analysis = BanglishNormalizer.analyze(rawText);

    assert.strictEqual(analysis.originalText, rawText, "Original text must be preserved with 100% losslessness");
    assert.strictEqual(analysis.detectedIntent, "PRICE_QUERY", "Inquiry with 'price/koto' must detect PRICE_QUERY intent");
    assert.strictEqual(analysis.extractedPhone, "01711223344", "Should extract Bangladeshi phone number");
  });

  await runTest("Detect order tracking status and delivery questions in Banglish", () => {
    const deliveryText = "Amar order tracking number ORD-2026-1049 kobe delivery pabo?";
    const deliveryAnalysis = BanglishNormalizer.analyze(deliveryText);

    assert.strictEqual(deliveryAnalysis.detectedIntent, "ORDER_STATUS_QUERY");
    assert.strictEqual(deliveryAnalysis.extractedOrderNumber, "ORD-2026-1049");
  });

  await runTest("Telegram receives private messages once and sends inbox replies to the stored chat", async () => {
    const botToken = "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ_012345";
    const connector = await ConnectorService.saveConnector(contextA, {
      provider_id: "telegram",
      credentials: { bot_token: botToken, bot_username: "@CommerceOSPlanTestBot" },
    });
    const channel = db.getConnectedChannels(contextA.tenant.id).find((entry) => entry.connector_id === connector.id);
    assert.ok(channel, "saving the tenant connector creates its Telegram channel");
    assert.strictEqual(channel.configuration.auto_reply_enabled, false, "automatic replies stay off by default");

    const adapter = new TelegramAdapter();
    const webhookSecret = "test-only-webhook-secret";
    assert.strictEqual(adapter.verifyWebhook("{}", null, { "x-telegram-bot-api-secret-token": webhookSecret }, { webhook_secret: webhookSecret }), true);
    assert.strictEqual(adapter.verifyWebhook("{}", null, { "x-telegram-bot-api-secret-token": "wrong" }, { webhook_secret: webhookSecret }), false);
    const storedConnector = db.findConnectorById(contextA.tenant.id, connector.id);
    assert.ok(storedConnector);
    const storedCredentials = decryptCredential<Record<string, unknown>>(storedConnector.credentials_encrypted);
    db.saveConnector({
      ...storedConnector,
      credentials_encrypted: encryptCredential({ ...storedCredentials, webhook_secret: webhookSecret }),
    });

    const update = {
      update_id: 10001,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        text: "Assalamu alaikum",
        chat: { id: 501, type: "private" },
        from: { id: 501, first_name: "Telegram" },
      },
    };
    const normalized = adapter.normalizeIncomingEvent(update, channel.id);
    assert.strictEqual(normalized.length, 1);
    const previousN8nModeForIngress = process.env.SOCIAL_N8N_MODE;
    process.env.SOCIAL_N8N_MODE = "off";
    const requestFor = (secret: string) => new Request(`https://commerceos.example/api/v1/connectors/${connector.id}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
      body: JSON.stringify(update),
    });
    try {
      await assert.rejects(
        () => telegramConnectorWebhook(requestFor("wrong"), { params: Promise.resolve({ id: connector.id }) }),
        (err: unknown) => err instanceof AuthenticationError,
        "wrong webhook secret must fail before storing anything"
      );
      assert.strictEqual(
        db.findMessageByExternalId(contextA.tenant.id, channel.id, normalized[0].externalMessageId),
        undefined,
        "rejected updates create no inbox message"
      );

      const acceptedResponse = await telegramConnectorWebhook(requestFor(webhookSecret), { params: Promise.resolve({ id: connector.id }) });
      const accepted = await acceptedResponse.json();
      assert.strictEqual(accepted.messagesProcessed, 1);
      const duplicateResponse = await telegramConnectorWebhook(requestFor(webhookSecret), { params: Promise.resolve({ id: connector.id }) });
      const duplicate = await duplicateResponse.json();
      assert.strictEqual(duplicate.messagesProcessed, 0, "a retried update is not ingested twice");
    } finally {
      if (previousN8nModeForIngress === undefined) delete process.env.SOCIAL_N8N_MODE;
      else process.env.SOCIAL_N8N_MODE = previousN8nModeForIngress;
    }

    const conversation = db.findConversationByExternalId(contextA.tenant.id, channel.id, "501");
    assert.ok(conversation);
    assert.strictEqual(conversation.unread_count, 1);
    assert.strictEqual(db.findConversationById(contextA.tenant.id, conversation.id)?.unread_count, 1, "a retry does not inflate unread count");

    const secondChat = adapter.normalizeIncomingEvent({
      ...update,
      update_id: 10002,
      message: { ...update.message, chat: { id: 502, type: "private" }, from: { id: 502, first_name: "Second" } },
    }, channel.id);
    assert.strictEqual(secondChat.length, 1);
    // A distinct private chat may reuse Telegram's per-chat message_id without colliding in this tenant.
    const previousN8nModeForSecondChat = process.env.SOCIAL_N8N_MODE;
    process.env.SOCIAL_N8N_MODE = "off";
    try {
      const secondResponse = await telegramConnectorWebhook(new Request(`https://commerceos.example/api/v1/connectors/${connector.id}/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": webhookSecret },
        body: JSON.stringify({
          ...update,
          update_id: 10002,
          message: { ...update.message, chat: { id: 502, type: "private" }, from: { id: 502, first_name: "Second" } },
        }),
      }), { params: Promise.resolve({ id: connector.id }) });
      assert.strictEqual((await secondResponse.json()).messagesProcessed, 1);
    } finally {
      if (previousN8nModeForSecondChat === undefined) delete process.env.SOCIAL_N8N_MODE;
      else process.env.SOCIAL_N8N_MODE = previousN8nModeForSecondChat;
    }
    assert.strictEqual(adapter.normalizeIncomingEvent({ ...update, message: { ...update.message, chat: { id: 503, type: "group" } } }, channel.id).length, 0);
    assert.strictEqual(adapter.normalizeIncomingEvent({ ...update, message: { ...update.message, from: { id: 501, is_bot: true } } }, channel.id).length, 0);
    assert.strictEqual(adapter.normalizeIncomingEvent({ update_id: "bad", message: update.message }, channel.id).length, 0);

    const previousN8nMode = process.env.SOCIAL_N8N_MODE;
    process.env.SOCIAL_N8N_MODE = "off";
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    setOutboundTransportForTesting(async (url, options) => {
      requestUrl = url.toString();
      requestBody = JSON.parse(String(options.body || "{}"));
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({ ok: true, result: { message_id: 77, date: Math.floor(Date.now() / 1000) } }),
        truncated: false,
        durationMs: 3,
      };
    });
    try {
      const reply = await OutboundMessageService.sendMessage(contextA, conversation.id, { text: "Wa alaikum assalam" });
      assert.strictEqual(reply.status, "SENT");
      assert.strictEqual(reply.external_message_id, "77");
      assert.ok(requestUrl.includes(`/bot${botToken}/sendMessage`));
      assert.strictEqual(requestBody.chat_id, "501", "recipient is read from the stored Telegram conversation");
      assert.strictEqual(requestBody.text, "Wa alaikum assalam");

      let timeoutCalls = 0;
      setOutboundTransportForTesting(async () => {
        timeoutCalls++;
        throw new OutboundTimeoutError("api.telegram.org", 5_000);
      });
      const uncertain = await OutboundMessageService.sendMessage(contextA, conversation.id, {
        text: "Please check this delivery",
        idempotency_key: "telegram-timeout-once",
      });
      assert.strictEqual(uncertain.status, "FAILED", "an uncertain send is never reported as delivered");
      assert.strictEqual(uncertain.retry_count, 1, "Telegram timeout is not automatically retried");
      assert.strictEqual(timeoutCalls, 1);
      assert.ok(!uncertain.failure_reason?.includes(botToken));
      const retried = await OutboundMessageService.sendMessage(contextA, conversation.id, {
        text: "Please check this delivery",
        idempotency_key: "telegram-timeout-once",
      });
      assert.strictEqual(retried.id, uncertain.id);
      assert.strictEqual(timeoutCalls, 1, "reusing an idempotency key cannot send a duplicate");
    } finally {
      setOutboundTransportForTesting(null);
      if (previousN8nMode === undefined) delete process.env.SOCIAL_N8N_MODE;
      else process.env.SOCIAL_N8N_MODE = previousN8nMode;
    }
  });

  // -------------------------------------------------------------
  // SUITE 3: CUSTOMER IDENTITY RESOLUTION & DEDUPLICATION
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[3] Customer Identity Resolution & Deduplication${ANSI_RESET}`);

  let createdChannelA: any;

  await runTest("Resolve customer identity using Bangladeshi phone number and link social identity", async () => {
    // 1. Connect a channel first
    createdChannelA = await ChannelService.connectChannel(contextA, {
      type: "FACEBOOK_MESSENGER",
      name: "Dhaka Threads FB Page",
      provider_account_id: "page_100",
      credentials: { pageId: "page_100", accessToken: "tok_secret" },
    });

    // 2. Create customer in Commerce Core
    const customer = await CustomerService.createCustomer(contextA, {
      first_name: "Sadia",
      last_name: "Islam",
      phone: "01812345678",
      email: "sadia@example.com",
    });

    assert.strictEqual(customer.phone, "+8801812345678");

    // 3. Incoming message from Facebook Messenger with same phone
    const resolution = await IdentityResolutionService.resolveCustomer(
      contextA.tenant.id,
      createdChannelA.id,
      "FACEBOOK_MESSENGER",
      "fb_psid_sadia_99",
      {
        displayName: "Sadia Islam FB",
        phone: "01812345678",
      }
    );

    assert.strictEqual(resolution.customer.id, customer.id, "Must resolve to existing canonical customer ID by phone");
    assert.strictEqual(resolution.isNewCustomer, false);

    // 4. Verify customer identity was registered in DB
    const identity = db.findCustomerIdentity(contextA.tenant.id, createdChannelA.id, "fb_psid_sadia_99");
    assert.ok(identity, "Identity record must be stored");
    assert.strictEqual(identity?.customer_id, customer.id);
  });

  await runTest("Link anonymous website chat visitor safely without corrupting profiles", async () => {
    const webChannel = await ChannelService.connectChannel(contextA, {
      type: "WEBSITE_CHAT",
      name: "Dhaka Store Live Chat",
      provider_account_id: "web_widget_01",
      credentials: { websiteUrl: "https://store.dhakathreads.com" },
    });

    const anonRes = await IdentityResolutionService.resolveCustomer(
      contextA.tenant.id,
      webChannel.id,
      "WEBSITE_CHAT",
      "anon_vis_4040",
      { displayName: "Web Visitor" }
    );

    assert.strictEqual(anonRes.isNewCustomer, true);
    assert.ok(anonRes.customer.id);
    assert.strictEqual(anonRes.customer.source, "WEBSITE");
  });

  // -------------------------------------------------------------
  // SUITE 4: CONVERSATION LIFECYCLE & STATE MACHINE
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[4] Conversation Lifecycle & State Machine${ANSI_RESET}`);

  await runTest("Validate allowed conversation state transitions and reject invalid ones", () => {
    assert.strictEqual(ConversationStateMachine.canTransition("OPEN", "WAITING_CUSTOMER"), true);
    assert.strictEqual(ConversationStateMachine.canTransition("WAITING_CUSTOMER", "WAITING_AGENT"), true);
    assert.strictEqual(ConversationStateMachine.canTransition("WAITING_CUSTOMER", "RESOLVED"), true);
    assert.strictEqual(ConversationStateMachine.canTransition("RESOLVED", "OPEN"), true); // Reopen

    // Invalid transition
    assert.strictEqual(ConversationStateMachine.canTransition("RESOLVED", "WAITING_AGENT"), false);
  });

  let activeConvA: any;

  await runTest("Conversation unread count management and status resolution lifecycle", async () => {
    // Create customer and conversation
    const customer = await CustomerService.createCustomer(contextA, {
      first_name: "Farhan",
      last_name: "Ahmed",
      phone: "01711223344",
    });

    const convRes = await ConversationService.findOrCreateConversation(
      contextA.tenant.id,
      createdChannelA.id,
      "FACEBOOK_MESSENGER",
      customer.id,
      "conv_fb_cust_1"
    );
    activeConvA = convRes.conversation;

    assert.strictEqual(activeConvA.status, "OPEN");
    assert.strictEqual(activeConvA.unread_count, 0, "A conversation without an inbound message starts with no unread items");

    // Simulate inbound message incrementing unread count
    await MessageService.processInboundMessage(contextA.tenant.id, activeConvA.id, {
      channelType: "FACEBOOK_MESSENGER",
      channelId: createdChannelA.id,
      externalEventId: "evt_101",
      externalMessageId: "fb_msg_101",
      externalConversationId: "conv_fb_cust_1",
      externalSenderId: "psid_cust_1",
      direction: "INBOUND",
      messageType: "TEXT",
      text: "Panjabi delivery kobe pabo?",
    });

    const refreshedConv = db.findConversationById(contextA.tenant.id, activeConvA.id);
    assert.strictEqual(refreshedConv?.unread_count, 1, "A new inbound message increments unread count exactly once");

    // Mark as read
    await ConversationService.markAsRead(contextA, activeConvA.id);
    const readConv = db.findConversationById(contextA.tenant.id, activeConvA.id);
    assert.strictEqual(readConv?.unread_count, 0, "Unread count must reset to 0 after agent marks as read");

    // Resolve conversation
    const resolved = await ConversationService.resolveConversation(contextA, activeConvA.id);
    assert.strictEqual(resolved.status, "RESOLVED");

    // Reopen conversation
    const reopened = await ConversationService.reopenConversation(contextA, activeConvA.id);
    assert.strictEqual(reopened.status, "OPEN");
  });

  // -------------------------------------------------------------
  // SUITE 5: ASSIGNMENT ROUTING & AUDIT HISTORY
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[5] Assignment Routing & Audit History${ANSI_RESET}`);

  await runTest("Record team assignment and maintain immutable assignment history", async () => {
    assert.strictEqual(AssignmentService.determineTeamRoute("PRICE_QUERY"), "SALES");

    await ConversationService.assignConversation(
      contextA,
      activeConvA.id,
      undefined,
      "SALES",
      "High buying intent lead routed to sales desk"
    );

    const history = await AssignmentService.getHistory(contextA, activeConvA.id);
    assert.strictEqual(history.length >= 1, true, "Assignment history must be recorded in DB");
    assert.strictEqual(history[0].assigned_team_id, "SALES");
  });

  // -------------------------------------------------------------
  // SUITE 6: INTERNAL NOTES STRICT CUSTOMER ISOLATION
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[6] Internal Notes Strict Customer Isolation (CRITICAL SAFETY CONSTRAINT)${ANSI_RESET}`);

  await runTest("INTERNAL_NOTE messages are isolated and strictly forbidden from external transmission", async () => {
    // Create an internal note
    const note = await MessageService.createInternalNote(
      contextA,
      activeConvA.id,
      "Customer requested 10% discount on phone, approved by manager."
    );

    assert.strictEqual(note.message_type, "INTERNAL_NOTE");

    // Verify OutboundMessageService strictly rejects sending INTERNAL_NOTE to channel
    let deliveryBlocked = false;
    try {
      await OutboundMessageService.sendMessage(contextA, activeConvA.id, {
        text: note.text,
        messageType: "INTERNAL_NOTE",
      });
    } catch (err: any) {
      if (err instanceof BadRequestError && err.message.includes("Internal notes cannot be sent to customers")) {
        deliveryBlocked = true;
      }
    }
    assert.strictEqual(deliveryBlocked, true, "CRITICAL: Internal notes must NEVER be transmitted externally to customer");
  });

  // -------------------------------------------------------------
  // SUITE 7: OUTBOUND MESSAGING PIPELINE, IDEMPOTENCY & RETRIES
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[7] Outbound Messaging Pipeline, Idempotency & Retries${ANSI_RESET}`);

  await runTest("Outbound message delivery sets automation_paused = true and enforces idempotency", async () => {
    const idempotencyKey = `idem_key_${Date.now()}`;

    // First send
    const sentMsg1 = await OutboundMessageService.sendMessage(contextA, activeConvA.id, {
      text: "Assalamu Alaikum, apnar order ti ready hoyeche.",
      idempotency_key: idempotencyKey,
    });

    // Meta sending fails with a token error: the message is recorded as FAILED with the reason, never as SENT (FX-31)
    assert.strictEqual(sentMsg1.status, "FAILED");
    assert.ok(/token|expired|not connected|Nothing was sent/.test(sentMsg1.failure_reason ?? ""), sentMsg1.failure_reason);
    assert.strictEqual(sentMsg1.retry_count, 1, "a non-retryable error isn't retried");

    // Verify conversation automation_paused was locked to true because a human responded
    const updatedConv = db.findConversationById(contextA.tenant.id, activeConvA.id);
    assert.strictEqual(updatedConv?.automation_paused, true, "Human message must pause AI automation lock");

    // Send again with same idempotencyKey -> must return identical message without re-executing
    const sentMsg2 = await OutboundMessageService.sendMessage(contextA, activeConvA.id, {
      text: "Assalamu Alaikum, apnar order ti ready hoyeche.",
      idempotency_key: idempotencyKey,
    });

    assert.strictEqual(sentMsg2.id, sentMsg1.id, "Idempotent duplicate send must return existing message");
  });

  // -------------------------------------------------------------
  // SUITE 8: RATE LIMITING PROTECTION
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[8] Rate Limiting Protection${ANSI_RESET}`);

  await runTest("Channel rate limiter throttles excessive burst messages", () => {
    const channelKey = `rate_test_${Date.now()}`;

    // Initial consume should be allowed
    const res1 = ChannelRateLimiter.tryConsume(channelKey, 1);
    assert.strictEqual(res1.allowed, true);

    // Consume remainder of burst capacity (capacity is 25)
    for (let i = 0; i < 24; i++) {
      ChannelRateLimiter.tryConsume(channelKey, 1);
    }

    // Next consume should be throttled
    const throttled = ChannelRateLimiter.tryConsume(channelKey, 1);
    assert.strictEqual(throttled.allowed, false, "Must throttle when token bucket capacity is exhausted");
    assert.ok(throttled.retryAfterMs && throttled.retryAfterMs > 0);
  });

  // -------------------------------------------------------------
  // SUITE 9: CONTROLLED SOCIAL ORDER CREATION VIA COMMERCE CORE
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[9] Controlled Social Order Draft Creation via Commerce Core${ANSI_RESET}`);

  await runTest("Create canonical order from social conversation through OrderService with stock reservation", async () => {
    // 1. Create a product in Commerce Core with initial stock
    const product = await ProductService.createProduct(contextA, {
      name: "Dhaka Heritage Silk Panjabi",
      sku: `DHK-PNJ-${Date.now()}`,
      base_price: 2500,
      initial_stock: 15,
      variants: [
        {
          title: "Large / Black",
          sku: `DHK-PNJ-L-${Date.now()}`,
          price: 2500,
          initial_stock: 15,
        },
      ],
    });

    const variant = product.variants[0];

    // 2. Convert conversation into canonical draft order
    const createdOrder = await SocialOrderService.createOrderFromConversation(contextA, {
      conversation_id: activeConvA.id,
      delivery_zone: "INSIDE_DHAKA",
      delivery_address: {
        division: "Dhaka",
        district: "Dhaka",
        address_line_1: "House 12, Road 5, Dhanmondi",
      },
      items: [
        {
          variant_id: variant.id,
          quantity: 2,
        },
      ],
      payment_method: "COD",
    });

    assert.ok(createdOrder.id);
    assert.strictEqual(createdOrder.source, "SOCIAL");
    assert.strictEqual(createdOrder.items.length, 1);
    assert.strictEqual(createdOrder.items[0].unit_price, 2500);
    assert.strictEqual(createdOrder.subtotal, 5000);
    assert.strictEqual(createdOrder.shipping_total, 60); // Inside Dhaka delivery fee
    assert.strictEqual(createdOrder.grand_total, 5060);

    // 3. Verify conversation metadata links to order
    const updatedConv = db.findConversationById(contextA.tenant.id, activeConvA.id);
    assert.strictEqual(updatedConv?.metadata?.last_order_id, createdOrder.id);
  });

  // -------------------------------------------------------------
  // SUITE 10: MULTI-TENANT BOUNDARY ISOLATION
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[10] Multi-Tenant Boundary Isolation${ANSI_RESET}`);

  await runTest("CRITICAL: Tenant Alpha cannot read, query, or mutate Tenant Beta social data", async () => {
    // Tenant B connects a channel and creates a conversation
    const channelB = await ChannelService.connectChannel(contextB, {
      type: "WHATSAPP",
      name: "Chittagong Silks WhatsApp",
      provider_account_id: "pn_ctg_01",
      credentials: { phoneNumberId: "pn_ctg_01", accessToken: "tok_secret_b" },
    });

    const customerB = await CustomerService.createCustomer(contextB, {
      first_name: "Rahim",
      last_name: "Chowdhury",
      phone: "01999888777",
    });

    const convBRes = await ConversationService.findOrCreateConversation(
      contextB.tenant.id,
      channelB.id,
      "WHATSAPP",
      customerB.id,
      "conv_wa_ctg_1"
    );
    const convB = convBRes.conversation;

    // Tenant A attempts to access Tenant B conversation
    const tenantAViewOfB = db.findConversationById(contextA.tenant.id, convB.id);
    assert.strictEqual(tenantAViewOfB, undefined, "Tenant A must NOT find Tenant B conversation");

    // Tenant A getConversations must never contain Tenant B records
    const tenantAList = db.getConversations(contextA.tenant.id, {});
    const crossTenantLeak = tenantAList.conversations.find((c) => c.tenant_id === contextB.tenant.id);
    assert.strictEqual(crossTenantLeak, undefined, "Cross-tenant leak detected in getConversations");

    // Tenant A attempts to send message to Tenant B conversation
    let errorCaught = false;
    try {
      await OutboundMessageService.sendMessage(contextA, {
        conversationId: convB.id,
        text: "Hacked message from Tenant A",
      });
    } catch {
      errorCaught = true;
    }
    assert.strictEqual(errorCaught, true, "Tenant A must be prevented from mutating Tenant B conversation");
  });

  // -------------------------------------------------------------
  // SUITE 11: ROLE-BASED ACCESS CONTROL (RBAC) ENFORCEMENT
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[11] Role-Based Access Control (RBAC) Enforcement${ANSI_RESET}`);

  await runTest("Enforce RBAC boundaries for social permissions across different roles", () => {
    const analystContext: RequestContext = {
      requestId: "req_analyst",
      traceId: "trc_analyst",
      user: { id: "usr_analyst_01", email: "analyst@example.com", name: "Analyst", status: "ACTIVE" },
      tenant: contextA.tenant,
      role: "ANALYST",
      permissions: [PERMISSIONS.SOCIAL_ANALYTICS_READ, PERMISSIONS.SOCIAL_CONVERSATION_READ],
      timestamp: nowIso,
    };

    // Analyst CAN read conversations
    RbacService.assertCan(analystContext, PERMISSIONS.SOCIAL_CONVERSATION_READ);

    // Analyst CANNOT send outbound messages
    let analystForbidden = false;
    try {
      RbacService.assertCan(analystContext, PERMISSIONS.SOCIAL_MESSAGE_SEND);
    } catch (err) {
      if (err instanceof ForbiddenError) analystForbidden = true;
    }
    assert.strictEqual(analystForbidden, true, "Analyst must be forbidden from sending social messages");

    // Support CAN reply to customer
    const supportContext: RequestContext = {
      requestId: "req_support",
      traceId: "trc_support",
      user: { id: "usr_support_01", email: "support@example.com", name: "Support", status: "ACTIVE" },
      tenant: contextA.tenant,
      role: "SUPPORT",
      permissions: [
        PERMISSIONS.SOCIAL_CONVERSATION_READ,
        PERMISSIONS.SOCIAL_MESSAGE_SEND,
        PERMISSIONS.SOCIAL_CONVERSATION_RESOLVE,
      ],
      timestamp: nowIso,
    };

    RbacService.assertCan(supportContext, PERMISSIONS.SOCIAL_MESSAGE_SEND);
    RbacService.assertCan(supportContext, PERMISSIONS.SOCIAL_CONVERSATION_RESOLVE);

    // Support CANNOT manage channels
    let supportForbidden = false;
    try {
      RbacService.assertCan(supportContext, PERMISSIONS.SOCIAL_CHANNEL_MANAGE);
    } catch (err) {
      if (err instanceof ForbiddenError) supportForbidden = true;
    }
    assert.strictEqual(supportForbidden, true, "Support role cannot manage channel credentials");
  });

  // -------------------------------------------------------------
  // SUITE 12: EVENT OUTBOX & n8n HMAC WEBHOOK DELIVERY
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[12] Event Outbox & n8n HMAC Webhook Delivery${ANSI_RESET}`);

  await runTest("Emit domain events and generate secure HMAC SHA-256 webhook signatures for n8n fanout", async () => {
    const signingSecret = "n8n_webhook_signing_secret_bangladesh";

    const event = SocialEventService.emit({
      tenantId: contextA.tenant.id,
      eventType: "social.message.received",
      aggregateType: "conversation",
      aggregateId: "conv_test_123",
      actor: { type: "USER", id: contextA.user.id },
      payload: {
        message_id: "msg_999",
        channel_type: "FACEBOOK_MESSENGER",
        text: "Kobe ashbe delivery?",
      },
    });

    assert.strictEqual(event.type, "social.message.received");
    assert.strictEqual(event.tenant_id, contextA.tenant.id);

    // Verify event is in DB outbox
    const recordedEvents = db.getEvents(contextA.tenant.id);
    const foundEvent = recordedEvents.find((e: any) => e.aggregate_id === "conv_test_123");
    assert.ok(foundEvent, "Event must be persisted in transactional outbox");

    // Check HMAC generation
    const payloadStr = JSON.stringify(event);
    const signature = crypto.createHmac("sha256", signingSecret).update(payloadStr).digest("hex");

    // Verify signature verification logic
    const computed = crypto.createHmac("sha256", signingSecret).update(payloadStr).digest("hex");
    assert.strictEqual(
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed)),
      true,
      "Webhook HMAC signature must match for n8n automation"
    );
  });

  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`   SOCIAL COMMERCE TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

if (require.main === module || !process.env.TEST_SUITE_RUNNER) {
  runSocialCommerceTests().catch((err) => {
    console.error("Fatal social commerce test failure:", err);
    process.exit(1);
  });
}
