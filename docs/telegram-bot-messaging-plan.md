# Telegram Bot Messaging Implementation Plan

**Status:** Telegram inbox messaging is implemented; AI auto-replies are planned in §9 and are not implemented; live-provider verification remains pending.
**Date:** 2026-10-03
**Related plan:** [`connector-implementation-plan.md`](connector-implementation-plan.md), phase C3.

## 1. Goal

Let a merchant connect a Telegram bot, receive customer messages in the CommerceOS inbox, and reply from that inbox. A reply must be sent by Telegram before CommerceOS marks it `SENT`. The implemented first slice covers private one-to-one chats; group/channel messaging and automatic AI replies are separate follow-up scope.

## 2. Environment variables and tenant credentials

CommerceOS is multi-tenant. The Telegram bot token must remain a per-tenant connector credential, encrypted with `CREDENTIALS_ENCRYPTION_KEY`. Do not add a global `TELEGRAM_BOT_TOKEN` fallback: every tenant would otherwise use the same bot, webhook routing would be ambiguous, and revoking one merchant's access would affect all merchants.

Use environment variables for deployment-level configuration only:

| Variable | Purpose |
|---|---|
| `APP_URL` | Public HTTPS origin used to register each tenant bot's webhook. Must be reachable by Telegram. |
| `CREDENTIALS_ENCRYPTION_KEY` | Existing key used to encrypt connector credentials at rest. |
| `N8N_HOST` and `SOCIAL_N8N_MODE` | Optional existing social-event orchestration. Keep the direct CommerceOS path available if n8n is not configured. |
| `COMMERCEOS_N8N_WEBHOOK_SECRET` / `COMMERCEOS_N8N_CALLBACK_TOKEN` | Existing, separate secrets if the n8n path is enabled. Never put the Telegram bot token in n8n envelopes. |

The UI should tell the merchant that the token belongs to their bot and will be stored encrypted. The only global-bot mode considered here is a future, explicit single-bot deployment mode with a single configured owner and deliberate tenant routing; it is not part of this implementation.

## 3. Current code to reuse and gaps to close

Existing pieces in the repository:

- Telegram connector manifest and encrypted credential storage.
- `getMe` credential check in `src/domains/connectors/live-checks.ts`.
- Telegram adapter methods for webhook authentication, private-message normalization, and `sendMessage`.
- Connector-created Telegram channel that references the connector instead of duplicating its credentials.
- Connector webhook endpoint at `/api/v1/connectors/[id]/webhook`, which checks Telegram's secret-token header and passes events to the social ingress path.
- Connector service actions for `set-webhook` and `webhook-info`.
- Existing social inbox ingestion and outbound dispatch paths.

Gaps to confirm or implement:

1. The connector page currently has no visible action that registers and inspects the Telegram webhook. The route/service actions exist; wire them to clear UI states.
2. Prove the whole Telegram event path: registered webhook → verified request → deduplicated update → inbox conversation → merchant reply → actual Telegram message.
3. Ensure the current social outbound route selects the Telegram adapter and resolves the recipient from the Telegram identity/chat id. The adapter alone is not proof that inbox replies are wired end to end.
4. Test database durability, retries, disabled-connector behavior, n8n fallback behavior, and health/status reporting around the external call boundaries.
5. Current Telegram normalization accepts private chats only. State this limitation in the guide and UI; do not imply group or channel support.

Before implementation, reconcile this inventory against `.agent/STATUS.md` and the actual branch. That file remains authoritative for claims about live capabilities.

## 4. Scope and acceptance criteria

### In scope

- Connect one Telegram bot per tenant through the existing connector UI.
- Validate the token with a real Telegram `getMe` call.
- Register and inspect a webhook from the connector UI.
- Receive Telegram private text messages in the correct tenant's inbox.
- Send a human merchant reply to the originating Telegram user.
- Show truthful connection, webhook, inbound, and outbound statuses.
- Provide a safe disconnect/disable path and document Telegram's one-webhook-per-bot behavior.

### Out of scope for the first release

- A platform-wide/shared bot token in environment variables.
- Automatic AI-generated replies (planned separately in §9), broadcasts, campaigns, groups, channels, media, buttons, and Telegram payments.
- Running Telegram long polling alongside webhooks. Telegram permits one update-delivery mode per bot; use webhooks for the hosted app.

### Acceptance

1. Two tenants can connect distinct bots; each incoming update reaches only the matching tenant/channel.
2. A bad, revoked, or malformed token never shows as connected or verified.
3. A webhook with a missing/wrong secret or unknown connector is rejected without processing or storing a message.
4. Replaying the same Telegram `update_id` does not create a duplicate message or conversation event.
5. A valid merchant reply reaches the correct Telegram chat; only a confirmed provider success changes the message to `SENT`.
6. Telegram timeouts, 429s, and 5xx responses remain truthful and do not create duplicate replies on retry.
7. Disabling or deleting a connector prevents further sends and invalidates its channel credential resolution.
8. No response, log, audit row, or n8n payload contains the bot token or webhook secret.
9. The UI explains required public HTTPS `APP_URL`, webhook setup state, and private-chat-only support.

## 5. Implementation phases

### T0. Trace and freeze contracts

- Read the applicable `.agent` integration, security, truthfulness, API, tenant-isolation, and testing rules.
- Trace connector save → channel creation → connector actions → webhook ingress → inbox persistence → outbound-message API/dispatch → adapter.
- Confirm all routes use the intended `withStore` mode. External network calls stay outside the store lock; follow-up state changes use short `db.unit(...)` writes.
- Define the Telegram payload fields used from `update_id`, `message.message_id`, `message.chat.id`, `message.from`, `message.text`, and `message.date`.
- Record the actual baseline in the implementation PR; don't mark the capability LIVE from a mocked test.

**Exit:** route/method/permission map and identified gaps reviewed; no schema migration assumed until the trace proves one is needed.

### T1. Make connector setup usable

- Add Telegram-specific “Register webhook” and “Check webhook” actions to the connector UI, calling the existing action routes.
- Register to `APP_URL/api/v1/connectors/<connector-id>/webhook` using a cryptographically random per-connector Telegram `secret_token` stored only inside encrypted connector credentials.
- Keep outbound Telegram calls outside the global store lock, then save the result in a short unit of work.
- Make registration repeatable and show whether Telegram points to this exact webhook URL, pending updates, and Telegram's last safe error summary.
- Disable registration with a plain explanation if `APP_URL` is missing, non-HTTPS, or not publicly configured. Do not show or log secrets.
- Update the setup guide to require the merchant to start the bot conversation; bots cannot initiate a private chat with a user who has never started them.

**Tests:** correct URL and secret are sent; secret persists encrypted; repeated registration is safe; malformed URL, provider failure, and missing `APP_URL` are reported honestly; tenant A cannot operate tenant B's connector.

### T2. Harden and prove inbound delivery

- Keep connector id as the routing key and connector row as the tenant authority; never accept tenant id from Telegram payloads.
- Verify `X-Telegram-Bot-Api-Secret-Token` in constant time before parsing/processing the update.
- Validate request size and JSON shape; accept supported private text messages; safely ignore unsupported updates, bot-originated messages, groups, and channels.
- Deduplicate by Telegram `update_id` in durable store state. Check the current event/idempotency store first; add schema only if no durable unique key exists.
- Acknowledge only after the update is durably accepted, with processing fast enough for Telegram's webhook deadline. Define a recoverable failure path so a database/n8n outage doesn't silently lose the message.
- Exercise the direct normalizer and, if enabled, the n8n raw → ingest path. n8n receives no bot token and cannot choose the tenant.

**Tests:** valid message; invalid signature; unknown/disabled connector; malformed and oversized body; duplicate update; other tenant's connector id; n8n unavailable with direct fallback; durable Postgres reload.

### T3. Wire human replies to Telegram

- Confirm the inbox compose route creates an outbound message scoped to the selected tenant and conversation.
- Resolve the recipient only from the stored Telegram customer identity/conversation (`chat.id`); don't accept arbitrary recipient ids from the browser.
- Resolve credentials through `channel.connector_id` and `ChannelService.getDecryptedCredentials`; fail closed if connector is missing or disabled.
- Use `TelegramAdapter.sendTextMessage` via the existing outbound-message lifecycle. Preserve HTML escaping/formatting policy and Telegram's 4096-character limit.
- Set `SENT` and `external_message_id` only after Telegram returns `ok: true`. Record provider failures as `FAILED` with a sanitized reason. Respect 429 `retry_after`; only retry when duplicate delivery cannot occur or after an idempotency/delivery strategy is in place.
- Ensure sending calls pass through the existing SSRF-guarded outbound client and channel/provider limits.

**Tests:** end-to-end mock inbox reply; correct chat id; connector/tenant isolation; disabled connector; Telegram 400/401/429/5xx, timeout, malformed success body; retries do not send duplicate messages; no credential leakage.

### T4. Merchant experience and operational controls

- Add UI states for token check, saved, webhook missing/mismatched, inbound ready, send failure, permission denied, and API/network unavailable.
- Explain that the merchant must press Start in the bot chat before receiving a private reply.
- Expose disable/re-enable or disconnect behavior without suggesting that Telegram webhook deletion was successful unless Telegram confirmed it.
- Add safe observability fields: connector id, channel id, event id, result class, latency; exclude message bodies and secrets from logs.
- Keep automated/AI replies disabled by default. Their implementation is specified separately in §9; the model must not invent prices, stock, order state, or execute sends without existing approval rules.

**Tests:** UI state/wiring review and role-based access; observable errors remain useful without provider response bodies or secrets.

### T5. Rollout and status

- Run `npm run type-check`, focused connector/social suites, the Postgres persistence suite for touched record/idempotency paths, and `npm run test:eval` if agent behavior changes.
- Run the security review for webhook, credential, or outbound changes; run `scripts/smoke-security.mjs` against a local server if routes/auth were changed.
- Perform an opt-in manual test with a dedicated Telegram test bot and test tenant: `getMe` → register webhook → message the bot → see inbox item → reply → receive reply in Telegram → replay and verify dedup.
- Never use a merchant's production bot as the test account. Rotate its token if it was exposed in logs/screenshots.
- Update `.agent/STATUS.md` with exact evidence. Keep Telegram `PARTIAL` until live credentials prove receive and reply end to end; distinguish stubbed tests from provider verification.
- Add an ADR only if implementation changes tenant credential ownership, webhook trust/routing, persistence schema, or agent authority boundaries.

## 6. Rollback

- Gate the new setup/inbox behavior behind a Telegram messaging feature flag if it changes an existing path.
- If rollout fails, disable Telegram send and webhook setup while preserving encrypted connector data and existing inbox history.
- Do not fall back to a shared environment token. Existing manual connector configuration should remain recoverable.

## 7. Product boundary

The default design in this plan assumes each merchant supplies and owns one Telegram bot token through the existing connector form, and staff replies manually from the inbox. If the product requirement is instead one CommerceOS-owned bot shared by every merchant, that is a different tenancy and webhook-routing design and needs an explicit product decision before code changes.

## 8. Implementation record

- **T1:** Connector UI exposes webhook registration and inspection. `APP_URL` must resolve to HTTPS; generated webhook secrets are persisted encrypted before calling Telegram and never returned to the browser.
- **T2:** The connector webhook verifies Telegram's secret-token header, accepts private text messages only, deduplicates Telegram updates, and avoids duplicate unread-count increments. Direct ingestion occurs in a short store unit after any optional n8n call.
- **T3:** Inbox replies use the stored conversation's Telegram chat id and encrypted connector token. Provider calls run outside the shared store lock; sent/failed states commit in short units. Telegram sends are not automatically retried after uncertain results because Telegram's send API has no idempotency key.
- **T4:** Webhook setup states and the private-chat/Start guidance are shown in the connector form. Automatic replies default off.
- **Verification:** Connector and social suites use a stubbed outbound transport. The PGlite suite reloads social and connector records successfully, but the full command still encounters the repository's Windows-only persistence worker failures. No live Telegram test bot has been used; keep the capability `PARTIAL`.

## 9. Follow-on plan: safe Telegram AI auto-replies

**Status:** Planned only. The Telegram inbox path currently stores inbound messages and emits `message.received`; it does not invoke `AgentRuntime` or send an AI-generated response. Telegram channels default to `configuration.auto_reply_enabled: false`. Setting `LLM_BASE_URL` and `LLM_API_KEY` configures the server-side model provider but does not enable or trigger this feature. In a split Vercel/Render deployment, chat-model environment variables belong on the Render backend. `GET /api/v1/ai/status` should report `LIVE` before an owner can enable autonomous replies.

### 9.1 Product and authority gates

- Add an explicit, per-Telegram-channel auto-reply switch in the social-channel/inbox settings. Keep it off by default; expose clear `OFF`, `COPILOT`, `AUTONOMOUS`, and `PAUSED` states with an immediate off switch.
- Require all of these server-side gates before any send: the channel is `ACTIVE`; the connector exists and is enabled; the channel opt-in is on; the tenant AI policy is enabled and set to `AI_AUTONOMOUS`; the `real_messaging` feature entitlement and safety gates pass; the conversation remains in AI mode and is not automation-paused; the inbound message is new and eligible.
- If the tenant uses `AI_COPILOT`, generate/store a suggestion for staff review only. Do not send it to Telegram. `DISABLED`, unconfigured/demo provider, human takeover, low confidence, unsupported update, and sensitive/handoff-required cases must not send an AI reply.
- Treat the AI reply as a customer-facing external action. Use a least-privilege tenant-scoped worker/service actor; never synthesize an `OWNER` identity or let the model decide whether it may bypass authorization, entitlements, or safety controls.
- Continue to support only private text chats for this phase. Group/channel messages and media remain unsupported.

### 9.2 Durable trigger and execution boundaries

- Trigger only after a newly persisted inbound message. Reuse the shared normalized-ingress path so direct Telegram ingress and optional n8n-normalized ingress have identical behavior.
- Enqueue a durable auto-reply job atomically with accepting the inbound message, keyed by tenant + channel + inbound message ID. Duplicate Telegram updates must not create a second job.
- Inspect the current event/outbox collections for durable claim, lease, recovery, and retry support. Reuse them only if they satisfy those guarantees; otherwise add a dedicated `social_auto_reply_jobs` collection/table with migrations, indexes/uniqueness, PGlite round-trip coverage, and a recoverable worker claim state (`PENDING`, `CLAIMED`, `COMPLETED`, `DEFERRED`, `FAILED`). Do not rely on a detached `void` promise or on n8n as the authoritative queue.
- Acknowledge the Telegram webhook after the inbox write and durable job acceptance. Run model inference and Telegram delivery outside the shared store lock. Persist job/agent-run state in short store units and reclaim expired claims after a worker restart.
- Before inference and again immediately before send, reload and re-check the channel, connector, AI policy, conversation mode, latest inbound message, and whether a human has taken over. A stale job must be safely deferred or cancelled.

### 9.3 Context engineering

- Extend/reuse `ContextBuilder` with an explicit Telegram auto-reply context contract. Every lookup must be scoped to `RequestContext.tenant.id` and the current conversation's `customer_id`, `channel_id`, and stored Telegram sender/chat identity. Never take tenant, customer, order, or recipient identity from model output or the webhook body after normalization.
- Assemble only information relevant to the current question, in a predictable order:
  1. Immutable system safety rules, tenant AI policy, mode, and permitted response actions.
  2. Channel constraints (Telegram private text; concise answer; Telegram length bound) and tenant-configured language/tone preferences, if present.
  3. The latest inbound message and a bounded chronological window of recent conversation turns.
  4. A bounded rolling summary and minimal customer preferences, only when relevant and with configured PII redaction applied.
  5. Authoritative read-only tool outputs for product, inventory, order, shipment, delivery-fee, or store-policy questions.
  6. Relevant knowledge-base passages, clearly marked as untrusted reference data rather than instructions.
- Set explicit token/character budgets per section, truncate by whole message/document boundaries, and prefer fresh tool results over stale summaries. Record which source categories and versions were used in the `AgentRun`; do not copy full database rows into prompts.
- No secrets, credentials, webhook headers, unrelated customer records, unscoped recent orders, hidden chain-of-thought, or other-tenant data may enter the context. Customer text, stored summaries, product descriptions, and retrieved documents are untrusted data and must be delimited as such.
- For commerce facts, permit read-only tools only. Prices, discounts, stock, order/payment state, shipping state, and fees must come from current authorized service/tool outputs. If a fact is absent, stale, or ambiguous, the agent must say it cannot confirm and ask a clarifying question or request human review.

### 9.4 Prompt engineering

- Create a versioned Telegram auto-reply prompt/overlay in `src/domains/ai/prompts/prompt-registry.ts` rather than embedding prompt text in the webhook route. Keep the specialized agent role prompts and tenant policy authoritative; add a channel-specific instruction layer and record its version on each run.
- Define the response contract explicitly: one concise customer-facing answer in the customer's language (Bangla, natural Banglish, or English); no internal commentary; no citations unless a user-facing source is useful; no claims unsupported by current context/tool output.
- State instruction precedence: system safety and CommerceOS policies > agent role and tenant rules > verified tool outputs > retrieved knowledge as data > customer message as untrusted input. Reject instructions embedded in customer text or retrieved content that try to reveal prompts/secrets, change policy, access another customer, or trigger unauthorized actions.
- In autonomous Telegram mode, do not expose write/action tools to the model. The model may request a server-controlled `REPLY`, `ASK_CLARIFICATION`, or `HANDOFF` outcome, but it cannot call Telegram send, change channel configuration, issue a refund, alter an order, offer an unapproved discount, or mutate stock. The backend decides whether to send after policy and validation checks.
- Include conservative escalation examples: explicit human request, anger/complaint, payment deducted but unconfirmed, cancellation/refund/dispute, unsupported media, missing identity/context, low routing confidence, conflicting tool facts, and any provider/model failure. Handoff is a control decision, not a prompt-only promise.
- Keep messages short and natural; enforce Telegram's 4096-character maximum after validation. Do not expose chain-of-thought, tool traces, policy text, or raw retrieval snippets to the customer.

### 9.5 Agent execution and response validation

- Invoke `AgentRuntime` with the persisted inbound message and stored conversation context only after job claim and policy checks. Add a dedicated auto-reply execution mode so existing interactive/coplay callers retain their behavior.
- Persist `AgentRun` with model/provider, agent type, prompt version, context-source metadata, tool-call count, usage/cost, latency, outcome, and handoff reason. Do not log raw customer text or secrets in operational logs.
- Send only when the run is `COMPLETED`, not copilot, not handoff-required, has a non-empty response, the latest eligibility checks still pass, and the response validator accepts it. Extend validation for unsupported commerce claims, grounding/source availability, secret/PII leakage, prohibited promises, language/length bounds, and control/instruction artifacts.
- If any gate or validator fails, do not send a fallback invented by the model. Save a reason-coded `DEFERRED`/`FAILED` outcome or a copilot suggestion and leave the conversation available for staff.
- Send through `OutboundMessageService` and the existing Telegram adapter using the stored conversation chat ID. Use a deterministic local idempotency key tied to the inbound message and auto-reply policy version. Because Telegram `sendMessage` has no idempotency key, never blindly retry an ambiguous timeout; mark uncertain state for staff review.
- A successful manual staff send must continue to pause automation. Resuming requires an explicit staff/owner action. Do not auto-resume after a later inbound message without a product-defined timeout policy.

### 9.6 Prompt/context evaluation and tests

- Add at least 20 golden scenarios following `.agent/workflows/agent-development.md`: Bangla/Banglish/English greetings and FAQs; exact price/stock/order/shipment grounding; missing data; ambiguous identity; policy/return questions; sensitive payment/refund/cancellation topics; human requests; prompt injection in customer text and retrieved knowledge; cross-tenant data bait; very long input; empty/invalid provider output; secret/PII leakage; and copilot vs autonomous modes.
- Add context-builder tests for tenant filters, current-customer-only records, message ordering/window limits, PII redaction, source freshness, token budgets, retrieval delimiters, missing source behavior, and ensuring no credentials enter prompts.
- Add prompt-contract tests for instruction hierarchy, refusal/handoff behavior, short natural Bangla/Banglish/English answers, unsupported fact handling, no tool/write authority, and version recording.
- Add end-to-end mocked tests for disabled-by-default, all enablement gates, duplicate update/job, durable worker restart/claim expiry, model unavailable/timeout/429, human takeover between inference and send, invalid response blocked, Telegram 429, confirmed send, ambiguous send timeout without duplicate retry, tenant isolation, and audit/usage records.
- Run `npm run type-check`, AI agent/eval tests, connector/social tests, relevant security and RBAC suites, and PGlite persistence round trips. No tests may use live merchant tokens or call a production bot.

### 9.7 Rollout and completion criteria

- Keep this capability `PARTIAL` until an owner explicitly enables it for a test Telegram channel and a dedicated test bot completes the live flow. Provider `LIVE` status alone is not evidence that auto-reply is enabled or safe.
- Roll out in stages: prompt/context eval only → copilot suggestions → owner-enabled autonomous replies for one test channel → gradual tenant opt-in with per-tenant budget/rate caps and a global kill switch.
- Provide visible pause/disable controls, last-run outcome, model/provider status, last failure category, and a clear handoff state. Keep message bodies, secrets, and model reasoning out of logs and dashboard telemetry.
- Done means: duplicate incoming webhook creates no duplicate job or reply; grounded eligible questions get at most one confirmed Telegram response; sensitive, uncertain, human-owned, or unsupported cases do not auto-send; each reply is traceable to tenant/channel/conversation/message and prompt/context version; disabling the toggle or global gate stops queued jobs before send.
