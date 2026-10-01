# Connectors: from a hardcoded catalog to dynamic, working integrations

**Status:** plan only, no code changed · **Date:** 2026-10-01 · **Owner:** Kawshik · **Evidence:** a read of `src/domains/connectors/**`,
`src/types/connector.ts`, `src/domains/social/**`, the shipping, courier-sync, marketing-channel and AI model-router services, and `.agent/STATUS.md`.
Nothing here was run against a live provider; "verify live" steps are yours (sandbox accounts, see §12).

Contents: 1 Findings · 2 Goals · 3 Design decisions · 4 Target architecture · 5 Data model · 6 API surface · 7 Provider decisions ·
8 Phases C0–C6 (tasks, files, tests, acceptance, rollback) · 9 Cross-cutting (security, testing, observability, rollout) · 10 Schedule · 11 Risks · 12 What I need from you.

---

## 1. Findings (what the code does today)

1. **38 providers, one catalog file.** `src/domains/connectors/service.ts` (1,685 lines) holds every provider's fields, guide and defaults, and branches on `provider.id` in `testConnection`. Adding a provider means editing that file.
2. **Two credential systems that don't talk to each other.**
   - *Connector hub* (`/connector` page, `/api/v1/connectors*`, collection `connector_configurations`): encrypted credentials + a connection test. No feature reads it except Google Sheets import.
   - *Social channels* (`/api/v1/social/channels*`, `connected_channels`): per-channel credentials used for inbound webhook verification and outbound sending.
   A Telegram, Meta or WhatsApp connector saved in the hub does not feed the channel the inbox uses.
3. **Verification:** 17 providers have a real HTTP check (`live-checks.ts`); 21 answer `NOT_VERIFIED` without calling anything.
4. **Using the connector is mostly missing:**
   - LLM, embeddings, Qdrant, Redis and DB use **server environment variables**; tenant connector entries are ignored.
   - **Couriers:** no booking API. `shipping.service.createShipment` requires a hand-typed tracking number. `courier-sync.service` only maps statuses.
   - **Telegram:** only `getMe`. `TelegramMarketingAdapter` returns `NOT_SENT`; `channel.service` maps `TELEGRAM` onto the Facebook adapter as a cast.
   - **Facebook, Instagram, WhatsApp:** the adapters verify webhooks and parse inbound events, but every send method throws `IntegrationNotConfiguredError("... sending isn't implemented yet")`.
5. **Weak defaults:** Telegram's `webhook_secret` defaults to a public constant; the guide text and placeholders are static strings.
6. **Reusable pieces already in the repo:** `outboundRequest` (SSRF guard), `provider-circuit-breaker`, `retry-queue`, `dead-letter`, `idempotency`, `safety-gate` (kill switches, plan limits), `rate-limit`, credential encryption (`encryptCredential`), the webhook machinery for couriers and payments, and `OrderLifecycleService` (the only order-status writer).

## 2. Goals and non-goals

**Goals**
- G1. A connector the UI shows as connectable must be **verifiable** and **used** by the feature it belongs to.
- G2. The catalog is **data-driven**: providers described by manifests and handled by drivers selected by capability, not `if/else` on ids.
- G3. Every outbound effect is **truthful**: success only when the provider accepted it; otherwise `FAILED`, `NOT_SENT`, `SIMULATED` or `NOT_VERIFIED`.
- G4. One credential model: the social channels read their credentials from the connector, not a second copy.

**Non-goals**
- Opening arbitrary TCP connections (databases, Redis) from tenant input.
- Building every enterprise system (SAP, NetSuite, Salesforce): served through n8n templates, not custom drivers.
- A visual connector builder for end users.

## 3. Design decisions (change one and the plan changes)

| # | Decision | Why |
|---|---|---|
| D1 | **Capability-based dispatch.** Features ask `resolve(ctx, "COURIER")`, never for a provider name. | Adding a courier becomes one file; features stop knowing providers |
| D2 | **Manifest + driver per provider**, kept as TypeScript in the repo (not a database table). | Type safety and review; the platform control plane can still switch providers off with a feature flag. A DB-stored catalog would let data change code paths without review |
| D3 | **One credential store: `connector_configurations`.** A social channel references a connector (`connector_id`) instead of holding credentials. Migrate existing channels. | Removes the second copy and the "saved but unused" confusion |
| D4 | **Per-tenant credentials first, platform default only where a plan allows it** (LLM, vectors). | Cost and isolation; matches your decision 3 in §12 |
| D5 | **Hosted-service limits:** HTTP(S) providers only. TCP databases and Redis are pruned. | A multi-tenant server must not dial tenant-chosen hosts and ports |
| D6 | **No new heavy dependency.** Drivers use `fetch` through `outboundRequest`. No provider SDKs. | AGENTS.md rule 8; smaller supply-chain surface |
| D7 | **Status of a provider is explicit:** `LIVE`, `BETA`, `COMING_SOON`. `LIVE` requires a recorded live verification. | Stops false promises |

## 4. Target architecture

```
UI (/connector, /social/channels)  -- renders forms and status from the manifest -->  /api/v1/connectors*
                                                                                         │ assertCan + Zod (per-manifest field schema)
Feature code: shipping, messaging, marketing, AI router, catalog import
        │  resolve(ctx, capability[, preferredConnectorId])
        ▼
ConnectorRuntime  ── loads tenant connector (decrypts in memory only) ──> Driver (one per provider)
        │                                                                   │ implements a capability interface
        ▼                                                                   ▼
Execution wrapper (every call): kill switch → plan limit → rate limit → circuit breaker → outboundRequest (SSRF guard)
        → retry with jittered backoff (idempotent calls only) → dead letter after N failures
        → audit row + connector health update (no credentials, no message bodies, no PII in logs)

Inbound: /api/v1/connectors/<id>/webhook  (generic)  → per-connector secret → signature + replay window + dedup → driver.parseInbound → domain services
```

Capability interfaces (new `src/domains/connectors/capabilities/*.ts`):
- `CourierDriver`: `createParcel`, `track`, `cancel`, `balance`, `parseWebhook`.
- `MessagingDriver`: `send`, `sendTemplate`, `setupWebhook`, `parseInbound`, `profile`.
- `LlmDriver`: `chat`, `embed`, `models`. `VectorDriver`: `upsert`, `query`, `delete`.
- `CatalogDriver`: `listProducts`, `getProduct`. `CrmDriver`: `pushContact`, `pushOrder`.
- Every driver also has `check(credentials)` and a `manifest`.

## 5. Data model

`ConnectorConfigRecord` (types/connector.ts) gains these fields. All optional so existing records stay valid; reads default them.

| Field | Purpose |
|---|---|
| `schema_version: number` | Lets a later credential-field change migrate stored records |
| `capabilities: string[]` | Copied from the manifest at save time, for fast lookups |
| `external_account_id?: string` | Bot id, page id, phone-number id, courier merchant id: for webhook routing and uniqueness |
| `webhook_secret_encrypted?: string` | Generated per connector, shown once, rotatable; replaces default secrets |
| `last_success_at`, `last_failure_at`, `consecutive_failures` | Health without a poller; drives the circuit and the UI |
| `last_error_code?: string` | A code (`UNAUTHORIZED`, `RATE_LIMITED`...), never provider text |
| `verified_at?: string`, `verified_by?: string` | Evidence that a live check passed |
| `enabled: boolean` | A tenant can pause a connector without deleting it |

Other record changes:
- `ConnectedChannel` (social): add `connector_id`; stop storing credentials once migrated (keep `credentials_encrypted` for rollback for one release).
- `ConnectorDeliveryLog` (new, small, retained 30 days): `connector_id`, `capability`, `action`, `status`, `latency_ms`, `error_code`, `idempotency_key`. No payloads.
- **Migration mechanics:** the store maps collections to Postgres tables (`src/infrastructure/store/store-schema.ts`). Check whether `connector_configurations` is a JSON document table (then no SQL change) or typed columns (then migration `009_connectors.sql`, expand-only, with a `-- rollback:` line, per `docs/render-runbook.md`). A one-time script `scripts/migrate-channels-to-connectors.ts` (dry run by default, backs up first, refuses while the app writes, like the existing data scripts) copies channel credentials into connectors.

## 6. API surface

Existing routes keep their paths and behavior (`/api/v1/connectors`, `/connectors/test`, `/connectors/[id]`). Additions:

| Route | Method | Permission | Purpose |
|---|---|---|---|
| `/api/v1/connectors/catalog` | GET | `settings.read` | Manifests (fields, guide, status, capabilities) for the UI; replaces the static list in the response |
| `/api/v1/connectors/[id]/rotate-secret` | POST | `settings.update` | New webhook secret, returned once |
| `/api/v1/connectors/[id]/enable` and `/disable` | POST | `settings.update` | Pause without deleting |
| `/api/v1/connectors/[id]/webhook` | POST/GET | none (signature/secret) | Generic inbound; tenant resolved from the connector row, never from the request |
| `/api/v1/connectors/[id]/actions/<name>` | POST | per action | Provider setup actions the UI offers: Telegram `set-webhook`, Meta `subscribe-page`, courier `list-zones`. Named, validated, audited |
| `/api/v1/platform/connectors/health` | GET | platform role | Cross-tenant health view for super-admin |

All handlers follow the canonical route pattern (`extractRequestContext`, `assertCan`, strict Zod, `withStore`).

## 7. Provider decisions (keep, build, or remove)

| Provider(s) | Today | Decision | Phase |
|---|---|---|---|
| Steadfast | live check | Build: book, track, cancel, balance, webhook | C2 |
| Pathao | none | Build (OAuth token with cache and refresh, city/zone/area lookup, create, track) | C2 |
| RedX, Paperfly, eCourier | none | `BETA` after Pathao if merchants use them; else `COMING_SOON` | C2 |
| DHL Express | none | `COMING_SOON` | |
| Telegram | `getMe` only | Build send + receive + marketing | C3 |
| WhatsApp Cloud | check; send not implemented | Build send, templates, receipts | C3 |
| Meta Graph (Facebook, Instagram) | check; send not implemented | Build Messenger and Instagram DM send | C3 |
| TikTok Shop, Google Ads | none | `COMING_SOON` | |
| OpenAI, Anthropic, Gemini, DeepSeek, Groq, OpenRouter | check; ignored by app | Build per-tenant override | C4 |
| Ollama, vLLM | check | Platform-only (private networks are blocked by design); hide from tenants | C4 |
| Qdrant | check; app uses env | Optional bring-your-own (https only) | C4 |
| Pinecone | check; unused | `COMING_SOON` (no Pinecone in the app now) or remove | C4 |
| Chroma, Milvus | none | Remove | C0 |
| pgvector dedicated, Supabase, Neon, self-hosted Postgres, MySQL | TCP | **Remove** (D5) | C0 |
| Redis self-hosted, Redis Cloud | TCP | **Remove** | C0 |
| Upstash Redis | check; unused | Keep only if a feature uses it; else remove | C0 |
| HubSpot | check | Build contact/order push | C5 |
| Shopify Plus | check | Build product and order sync | C5 |
| Google Sheets | real fetch | Keep; move into `CatalogDriver` | C5 |
| Daraz, SAP S/4HANA, NetSuite, Salesforce | none | `COMING_SOON`; offer n8n workflow templates | C5 |

Removed providers: existing saved records (if any) become read-only with a "no longer supported" banner for one release, then are deleted by a script after the owner confirms.

## 8. Phases

Each phase is one branch and pull request off `main`, behind a feature flag where behavior changes. Estimates: S ≤ 2 days, M ≈ 1 week, L ≈ 2 weeks.
Every phase must end with: type-check 0 errors · `npm test`, `npm run test:pg`, `npm run test:eval` green · `scripts/smoke-security.mjs` clean · `.agent/STATUS.md` updated with what is LIVE, PARTIAL or SIMULATED · a security review (`security-reviewer`) for phases touching auth, webhooks or credentials.

### C0. Foundations and cleanup (M) — no behavior change for kept providers
**Tasks**
1. `src/domains/connectors/manifest.ts`: `ProviderManifest` type (id, name, category, capabilities, fields with Zod validators, guide, `status`, `requiresPlan`).
2. `src/domains/connectors/providers/<id>.ts` for each kept provider: manifest + `check()`. Move the data out of `service.ts` verbatim first.
3. `src/domains/connectors/registry.ts`: id → driver; `catalog()` filters by status and feature flags.
4. `service.ts` slims to orchestration (list, save, test, delete) calling the registry; delete the `provider.id ===` branches. Keep `live-checks.ts` logic, now per driver.
5. Characterization tests **before** moving code: snapshot the provider list, field names, and the live-check request (URL, headers, no secrets) for the 17 live providers. They must pass unchanged after the refactor.
6. Remove the pruned providers (§7) from the registry. Reject saving them (`400 PROVIDER_NOT_SUPPORTED`); existing records stay readable.
7. Replace the default Telegram `webhook_secret` with generated-at-save (`webhook_secret_encrypted`); `grep` proves no default secret literal remains in `src/`.
8. Add `status` to the catalog response; UI hides `COMING_SOON` behind a "Coming soon" section (no Save button).
9. Add the new optional record fields (§5); no migration of data yet.
**Files:** `src/domains/connectors/**` (new and moved), `src/types/connector.ts`, `src/app/(dashboard)/connector/page.tsx` (read status), `tests/connectors-tests.ts` (+ new `connector-registry-tests.ts`).
**Accept:** existing `connectors-tests` and `phase5-integrations-tests` pass unmodified except for the pruned providers; catalog diff is exactly the pruned set; no default secret in `src/`; bundle of `service.ts` under 400 lines.
**Rollback:** revert the PR (records keep their ids and shape).

### C1. Verification coverage (S–M)
**Tasks**
1. Live checks for kept providers without one: Pathao (client-credentials token request, result discarded), RedX, Paperfly, eCourier (their documented auth endpoints). Any provider whose API has no safe auth-check endpoint becomes `BETA` and says "not verifiable".
2. Standardize the result: `VERIFIED | FAILED(code) | NOT_VERIFIABLE`; remove the ambiguous `NOT_VERIFIED` for providers that are shown as connectable.
3. Persist `verified_at`, `last_error_code`, `consecutive_failures` on every test and on every real call (C2 and later).
4. UI shows "Verified 3 min ago" or the error code with a plain-language fix hint from the manifest (`errorHints`).
**Tests:** stubbed transport per provider: 200, 401, 403, 404, 429, 5xx, timeout, malformed body → exact result codes; credentials never appear in the result or the log.
**Accept:** every `LIVE` or `BETA` provider has a check or a labelled "not verifiable"; no test makes a network call in CI.

### C2. Couriers that really book parcels (L)
**Tasks**
1. `capabilities/courier.ts` interface and a shared `CourierResult` (normalized statuses reuse `courier-sync.normalizeCourierStatus`).
2. `providers/steadfast.ts`: `createParcel` (invoice = order number, recipient name/phone/address, COD amount from the order, note), `track`, `cancel`, `balance`; signed-webhook parser for status updates.
3. `ConnectorRuntime.resolve(ctx, "COURIER", providerId?)`: picks the tenant's verified, enabled connector; returns a typed "no courier connected" result otherwise.
4. `shipping.service.createShipment`: if a courier connector is verified → call the driver with an **idempotency key = order id + courier**; store the courier's consignment id and tracking code; else keep today's manual tracking-number path and report `manual: true`. Never invent a tracking number.
5. Order lifecycle: moving to `SHIPPED` still goes through `OrderLifecycleService` only; a booking failure leaves the order unchanged and returns the reason.
6. Webhook route (generic from §6) for courier status updates → `CourierSyncService` → `OrderLifecycleService`. Existing per-endpoint courier webhooks keep working.
7. Pathao driver: token endpoint with an in-memory cache keyed by connector id and expiry minus 60 s; city/zone/area lookups exposed as an action for the UI; same `createParcel/track`.
8. RedX, Paperfly, eCourier as `BETA` if requested.
9. COD and RTO: record the COD amount sent; reconcile on delivered/returned events (hooks into the existing finance and RTO services; no new maths).
10. UI: on the shipment screen, a "Book with <courier>" action with a result panel; falls back to manual entry with the explanation.
**Resilience:** circuit breaker per connector; at most 2 retries with jitter on timeouts and 5xx for **idempotent** calls only; a create-parcel that times out is **reconciled by lookup** (search by invoice) before any retry, to avoid double bookings; failures after retries go to the dead-letter queue.
**Tests:** one parcel only on a retried request; timeout then reconcile finds the existing parcel; 401 flips the connector to `ERROR`; webhook replay and forged signature rejected; cross-tenant: tenant B cannot book through tenant A's connector; manual fallback unchanged.
**Accept:** with the stubbed courier the full order → book → webhook → delivered flow passes; STATUS shows Steadfast `LIVE` only after your sandbox check (§12).
**Rollback:** flag `connectors.couriers` off restores the manual path.

### C3. Messaging that sends and receives (L)
**Tasks**
1. `capabilities/messaging.ts`; adapt `IChannelProvider` to delegate to drivers so the inbox code path (`OutboundMessageService.transmitWithRetry`) is unchanged.
2. **Unify credentials (D3):** `ConnectedChannel.connector_id`; `ChannelService.getDecryptedCredentials` reads the connector. Add the migration script (dry run, backup, refuses while the app writes). Keep the old fields one release.
3. **Telegram:**
   - `providers/telegram.ts`: `send` → `sendMessage` (HTML parse mode with escaping), `sendPhoto`, `answerCallbackQuery`.
   - `setup` action: `setWebhook` with `secret_token` = the connector's generated webhook secret and `allowed_updates=["message","callback_query"]`; `getWebhookInfo` to report status.
   - Inbound: verify `X-Telegram-Bot-Api-Secret-Token` in constant time; dedup on `update_id`; map to a conversation and customer identity (`TELEGRAM:<chat id>`); ignore updates from unknown chats unless the merchant started the bot.
   - Marketing: replace `TelegramMarketingAdapter` stub with the driver; honor consent and frequency caps already enforced; report `SENT` only on `ok:true`.
   - Merchant alerts (order created, low stock) to `default_chat_id`, via the n8n/automation router with the kill switch.
   - Fix `channel.service`'s `TELEGRAM: new FacebookAdapter() as any` cast.
4. **WhatsApp Cloud:** `send` text and media, template messages (required outside the 24-hour window), delivery/read receipts into message status, per-entry webhook signature (already built), error mapping (131047 re-engagement window, 131026 undeliverable, rate limits).
5. **Facebook Messenger and Instagram DMs:** send via the Graph Send API with page access tokens, messaging-type and 24-hour rules, typing/seen optional, receipts.
6. Token health: a 401/190 from Meta flips the connector to `ERROR` with `TOKEN_EXPIRED`, stops retries and notifies the workspace owner.
**Tests (stubbed transport):** success, 429 with `Retry-After`, blocked user, revoked token, malformed response, oversized text split, template required outside window, forged/replayed webhooks, secret rotation invalidates the old secret, cross-tenant routing by `external_account_id`.
**Accept:** inbox reply on each channel returns `SENT` only on provider acceptance; every failure path is `FAILED` with a code; no message body in logs.
**Rollback:** per-channel-type flags; adapters fall back to the current `IntegrationNotConfiguredError`.

### C4. Bring-your-own AI and vectors (M–L)
**Tasks**
1. `ModelRouter` resolves in order: tenant `LLM_CHAT` connector → platform default (only if the plan allows) → `AI_PROVIDER_NOT_CONFIGURED`. Per-tenant client instances; keys never cached across tenants.
2. Reuse the existing OpenAI-compatible client for six providers (they differ only in base URL and model names); Anthropic and Gemini get small drivers.
3. **Budgets:** per-tenant daily token and cost caps; enforced **before** the call; real usage from the provider response (removes the fixed cost constants flagged in `production-readiness.md` P1-4); a 402/429-style refusal and an audit row on breach.
4. **Embeddings and vectors:** `EMBEDDINGS` connector separate from chat (Groq has none). Qdrant bring-your-own endpoint: https and standard ports only through the guard; platform Qdrant stays the default with the existing tenant payload filter. Changing the embedding model or dimensions blocks mixed-dimension writes and prompts a re-index.
5. UI: model picker from the provider's `/models` (cached 10 min), "test with a one-token prompt" action.
**Tests:** two tenants never share a client, key or budget; a tenant key is never logged or returned; breach refuses the call; kill switch for the provider stops tenant calls.
**Accept:** a tenant with its own Groq key chats through it and the platform key is untouched; cost shown equals provider-reported usage.

### C5. Commerce sync (M per provider)
1. `CatalogDriver`: move Google Sheets import into it (already real); the product import route calls the driver.
2. **Shopify:** products pull (cursor pagination) and order/product webhooks (HMAC), mapping to the catalog with source ids to prevent duplicates; one-way first.
3. **HubSpot:** push contacts and orders (idempotent upsert by email/phone key); no inbound.
4. n8n templates for SAP, NetSuite, Salesforce, Daraz exports, documented in `n8n/`.
5. Pulls run on the job queue (R1b in `production-readiness.md`); until it exists they are manual "Sync now" actions with a row limit.
**Accept:** re-running a sync creates no duplicates; a deleted remote item is flagged, not deleted locally.

### C6. Dynamic UI and operations (M)
1. `/connector` page renders cards, forms and guides from `/api/v1/connectors/catalog`; validation messages from the manifest's field schemas.
2. Status chips: Verified / Needs attention (code + hint) / Paused / Coming soon; last verified, last success, failure count.
3. Actions from the manifest (set webhook, subscribe page, sync now, rotate secret) with confirmation and audit.
4. Health sweep job (every 15 min, needs R1b): runs `check()` for enabled connectors, updates health, notifies the owner on a new `ERROR`.
5. Super-admin connector health page and a metric per provider (success rate, p95 latency) computed from `ConnectorDeliveryLog`, not invented.
6. Generated docs: one markdown page per provider from its manifest (`docs/connectors/<id>.md`).
**Accept:** adding a provider requires no UI change; accessibility pass on the forms (labels, errors, keyboard).

## 9. Cross-cutting

**Security (checked in every phase, reviewed by `security-reviewer`)**
- Tenant from the session; every connector lookup also filters by tenant; webhook routes resolve the tenant from the connector row.
- Credentials: encrypted at rest, decrypted only inside the driver call, never in logs, errors, API responses or the audit metadata; masked in the UI.
- Webhooks: per-connector secret, constant-time compare, timestamp window where the provider has one, dedup key from signed data, 600/min per connector.
- SSRF: only `outboundRequest`; tenant-entered base URLs use the tenant policy (https, standard ports, no private ranges); provider hosts that are fixed are constants.
- Least privilege: reading connectors needs `settings.read`; saving, testing, rotating and actions need `settings.update`; high-risk actions (change a courier, enable a messaging connector) are audited.
- Rate limits: test (10/min/workspace, existing), actions, and per-connector send limits.
- OWASP review items: injection into message templates (escape per provider), mass assignment (strict Zod per manifest), IDOR (tenant filter), secrets in URLs (never).

**Testing**
- Contract tests per driver with recorded fixtures through `setOutboundTransportForTesting`; **no live call in CI**.
- Property tests for credential masking and path/URL building (no injection of `/`, `?`, newlines).
- Tenant-isolation matrix test for every new route.
- Truthfulness sweep: for each driver, force each failure and assert no success status.
- Manual live checklist per provider recorded in STATUS before `LIVE`.
- Existing gates stay: `npm test`, `test:pg`, `test:eval`, `scripts/smoke-security.mjs`, audit gate, migration check.

**Observability**
- Log events: `connector.call` (connector id, capability, action, status, latency, error code), `connector.health_changed`. No payloads, no PII.
- Delivery log with 30-day retention; dashboard numbers come from it.
- Alerts: connector `ERROR` for 15 minutes, breaker open, dead-letter growth.

**Rollout**
- Flags (platform feature flags, `safety-gate`): `connectors.manifest`, `connectors.couriers`, `connectors.messaging.<type>`, `connectors.byo_ai`, `connectors.sync.<provider>`. Default off in production, on in staging, enabled per tenant for a pilot first.
- Each phase deploys to staging on a Neon branch first; pilot with one real merchant before general availability.

## 10. Schedule (one engineer, sequential; shorten by splitting C2 and C3 across two)

| Phase | Size | Depends on |
|---|---|---|
| C0 foundations and prune | M | none |
| C1 verification | S–M | C0 |
| C2 Steadfast, then Pathao | L | C0; sandbox access |
| C3 Telegram → WhatsApp → Messenger/Instagram | L | C0; bot and Meta test accounts |
| C4 bring-your-own AI and vectors | M–L | C0; decision on plan gating |
| C5 Shopify, HubSpot, Sheets | M each | C0; job queue (R1b) for pulls |
| C6 UI and operations | M | C1; job queue for the sweep |

Suggested order: **C0 → C2 (Steadfast) → C3 (Telegram) → C1 → C4 → C2 (Pathao) → C3 (Meta/WhatsApp) → C5 → C6**, so the first two business-visible wins arrive early.

## 11. Risks

| Risk | Mitigation |
|---|---|
| A provider changes its API | Contract fixtures plus a weekly health sweep; drivers are small and isolated |
| Meta app review / WhatsApp business verification delays | Start the review in parallel with C3; ship Telegram first |
| Double booking of parcels | Idempotency key, reconcile-before-retry, tests |
| Credential migration breaks live channels | Dry run, backup, keep old fields for a release, per-channel flag |
| Refactor changes behavior in C0 | Characterization tests first |
| Provider terms or fees (WhatsApp templates, SMS) | Surface cost notes in the manifest; budgets |
| Scope growth (38 providers) | Prune and `COMING_SOON`; add providers only on demand |
| Sandbox access unavailable | Provider stays `BETA`; STATUS records "not verified live" |

## 12. What I need from you before C0 starts

1. **Prune list (§7):** approve removing the TCP database and Redis connectors, Chroma, Milvus and Pinecone, and marking TikTok, Google Ads, DHL, Daraz, SAP, NetSuite and Salesforce `COMING_SOON`?
2. **Couriers in real use** among Steadfast, Pathao, RedX, Paperfly and eCourier.
3. **LLM and vectors:** platform key paid by you, bring-your-own per workspace, or both with plan gating?
4. **Sandbox access:** Steadfast and Pathao test merchant accounts, a Telegram bot token for testing, a Meta developer app with a test WhatsApp number. (Never paste tokens into chat; put them in Render env vars or your password manager.)
5. **Telegram scope:** merchant alerts only, or customer conversations too?
6. **Channel credential migration:** may I move social channel credentials into connectors (D3)? It touches live channels; I would do a dry run and show you the result first.
7. **Pilot merchant** for each phase, or only staging first?

Until these are answered I will not start code; the plan is safe to revise.
