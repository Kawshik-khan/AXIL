# Telegram Bot Messaging Implementation Plan

**Status:** Implementation in code; live-provider verification remains pending.
**Date:** 2026-10-02
**Related plan:** [`connector-implementation-plan.md`](connector-implementation-plan.md), phase C3.

## 1. Goal

Let a merchant connect a Telegram bot, receive customer messages in the CommerceOS inbox, and reply from that inbox. A reply must be sent by Telegram before CommerceOS marks it `SENT`. The first release covers private one-to-one chats; group/channel messaging and automatic AI replies are separate follow-up scope.

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
- Automatic AI-generated replies, broadcasts, campaigns, groups, channels, media, buttons, and Telegram payments.
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
- Keep automated/AI replies disabled by default. If added later, route them through the AI policy and commerce API; the model must not invent prices, stock, order state, or execute sends without existing approval rules.

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
