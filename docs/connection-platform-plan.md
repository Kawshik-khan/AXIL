# Connection platform: one way to connect every service

**Status:** plan only, no code changed · **Date:** 2026-10-20 · **Owner:** Kawshik · **Builds on:** `docs/connector-implementation-plan.md`
(C0 done; D1 capability dispatch and D3 one credential store still hold) · **Evidence:** a read of `src/domains/connectors/**`,
`src/domains/social/meta/meta-login.service.ts`, `src/domains/social/insights/meta-graph-reader.ts`, `src/app/(dashboard)/connector/**`,
`src/infrastructure/store/store-schema.ts`, and the security review of the 2026-10-20 ad-account change. Nothing here was run against a live
provider.

Contents: 1 Problem · 2 Goals · 3 Decisions · 4 Target model · 5 Architecture · 6 Data model · 7 API · 8 Phases P0–P6 · 9 Cross-cutting ·
10 Schedule · 11 Risks · 12 What I need from you

---

## 1. Problem (what the code does today)

1. **Three places hold credentials for one grant.** A Facebook login writes the Page token onto each `connected_channels` row, and (since
   2026-10-20) the long-lived *user* token and ad account onto the same rows. A manual `meta_graph` connector in `connector_configurations`
   can hold a fourth copy. `resolveMetaReadCredentials` has to guess which one wins.
2. **The user token has no owner, expiry or revoke.** It carries every granted scope (`business_management`, `pages_messaging`, ...),
   lives ~60 days, is copied per channel, and survives the member who granted it leaving the workspace (security review, MEDIUM).
3. **Every service has its own flow.** Meta has a popup + picker page, Telegram a token form plus webhook buttons, couriers a form, WhatsApp a
   pasted-token form. The connector page branches on provider ids (`META_PROVIDER_ID`, `telegram`).
4. **Status is "saved", not "working".** Cards say Active / Not configured from the save, not from a recent successful call or webhook.
   A token that expired yesterday still shows Active.
5. **Scopes are all-or-nothing.** The Meta login asks for nine permissions up front, including `ads_read`, whether or not the merchant uses
   Ad Manager. App Review needs a screencast per permission.
6. **Meta-required endpoints are missing:** deauthorize callback and data-deletion callback (needed before App Review).

## 2. Goals and non-goals

**Goals**
- G1. One **connection** per tenant grant, holding the only copy of its credentials, with owner, scopes, expiry and health.
- G2. **Resources** (Page, Instagram account, ad account, WhatsApp number, courier store) are listed from the provider and picked by the
  merchant; features bind to resources, never to raw tokens.
- G3. Features ask for a **capability** (`MESSAGING`, `ADS_READ`, `COURIER_BOOKING`), not a provider (extends D1).
- G4. One **connect flow per auth method** (about five), driven by the manifest. Adding an OAuth provider = one adapter file.
- G5. **Least privilege:** base scopes at connect; extra scopes asked when a feature is turned on (incremental consent).
- G6. **Truthful status:** derived from health checks and recent traffic; expiring and broken connections say "Reconnect".

**Non-goals**
- Rewriting the message send/receive adapters (C3 work stays as is; they only change where they read credentials).
- A marketplace or third-party connector SDK.
- Moving infra providers (LLM, vectors) into this model; they become platform-only (super-admin), see P6.

## 3. Design decisions (change one and the plan changes)

| # | Decision | Why |
|---|---|---|
| E1 | **`connector_configurations` becomes the Connection record** (new optional fields), not a new collection. | Keeps D3 (one credential store), the existing routes, encryption and tests; no data move for API-key providers |
| E2 | **New collection `connection_resources`** (JSONB document collection, no SQL table yet). | Resources are many per connection and need their own state; documents need no migration under ADR-108 |
| E3 | **Channels reference a resource** (`resource_id`), and read the Page token through it. `credentials_encrypted` on channels is kept one release for rollback, then emptied. | Removes the per-channel copies |
| E4 | **One user token per connection**, stored once, with `owner_user_id`, `scopes`, `expires_at`. Page tokens (non-expiring) are stored on their Page resource. | Fixes the MEDIUM finding at the root |
| E5 | **Incremental consent:** `ads_read` (and later `catalog_management`, `whatsapp_business_*`) is requested only by the feature that needs it. | Least privilege; smaller App Review |
| E6 | **Generic OAuth broker** (start / callback / popup hand-off) with per-provider adapters; today's Meta login becomes the first adapter. | One audited implementation of state, nonce, PKCE where supported, cookie handling |
| E7 | **Health is computed by a background job** and stored on the connection; GET routes only read it (rule 9). | Truthful status without writes on GET |
| E8 | **Member removal revokes their tokens:** connections owned by a removed member go to `NEEDS_REAUTH` and their token is deleted. | Tokens never outlive the person's access |
| E9 | **No provider SDKs**, all calls through `outboundRequest` (keeps D6, ADR-110). | Supply chain, SSRF guard |

An ADR (ADR-119, "Connections and resources") records E1–E9 in P0.

## 4. Target model

```
Platform app        env / super-admin: META_APP_ID + secret, GOOGLE_CLIENT_ID, TIKTOK_APP_ID ...   (one per provider, owner-configured)
   │
Connection          connector_configurations row — tenant_id, provider_id, auth_method, external_account_id (FB user / business),
   │                owner_user_id, scopes_granted[], token_encrypted, expires_at, status, health
   │
Resource            connection_resources row — connection_id, kind (FB_PAGE | IG_ACCOUNT | AD_ACCOUNT | WA_NUMBER | COURIER_STORE),
   │                external_id, name, token_encrypted? (Page token), status, unique per (kind, external_id) across tenants (H5)
   │
Binding             what uses it: connected_channels.resource_id (inbox), tenant settings ads.resource_id (Ad Manager),
                    shipping settings courier.resource_id (orders)
```

Connection status machine:

```
(pending cookie) ──activate POST──▶ ACTIVE ──health warn / expiring < 7d──▶ DEGRADED ──reconnect──▶ ACTIVE
                                    │
                                    ├─token rejected / deauthorized──▶ NEEDS_REAUTH ──reconnect──▶ ACTIVE
                                    └─merchant disconnects──▶ DISCONNECTED (tokens deleted, resources detached, channels paused)
```

## 5. Architecture

```
/connector page ── one card per manifest ── Connect ──▶ flow by auth_method
                                                       ├ oauth2          → popup → /api/v1/connections/{provider}/start → provider dialog
                                                       │                    → /api/v1/connections/{provider}/callback → popup hands off → resource picker
                                                       ├ embedded_signup → provider JS popup → /api/v1/connections/{provider}/exchange
                                                       ├ api_key         → form from manifest fields → live check → save
                                                       └ bot_token       → token field → live check → auto webhook setup
Feature code ── resolveCapability(ctx, "ADS_READ") ──▶ ConnectionRuntime ── decrypts in memory ──▶ adapter call via outboundRequest
Health job   ── every 6 h per connection ──▶ adapter.check() + token debug + webhook freshness ──▶ connection.health / status
Meta callbacks ── /api/v1/connections/meta/deauthorize, /data-deletion (signed_request) ──▶ NEEDS_REAUTH / deletion job + status URL
```

Adapter interface (`src/domains/connectors/auth/*.ts`, new):

```ts
interface OAuthAdapter {
  providerId: string;
  authorizeUrl(input: { state: string; redirectUri: string; scopes: string[]; codeChallenge?: string }): string;
  exchangeCode(code: string, redirectUri: string, codeVerifier?: string): Promise<TokenSet>;   // long-lived where the provider allows
  refresh?(token: TokenSet): Promise<TokenSet>;
  inspect(token: TokenSet): Promise<{ externalAccountId: string; scopes: string[]; expiresAt?: string }>;
  listResources(token: TokenSet, kinds: ResourceKind[]): Promise<ProviderResource[]>;          // no tokens leave the server
  activateResource?(token: TokenSet, resource: ProviderResource): Promise<ActivationResult>;   // e.g. Page subscribed_apps
  revoke?(token: TokenSet): Promise<void>;
}
```

## 6. Data model

**`ConnectorConfigRecord` (types/connector.ts) gains** (all optional; existing rows stay valid):

| Field | Purpose |
|---|---|
| `auth_method` | `oauth2` · `embedded_signup` · `api_key` · `bot_token` (from the manifest at save) |
| `owner_user_id` | Who granted it; E8 revokes on member removal |
| `scopes_granted: string[]` | From the provider's token inspection, not from what was asked |
| `token_expires_at` | Drives DEGRADED at < 7 days and the UI warning |
| `connection_status` | `ACTIVE` · `DEGRADED` · `NEEDS_REAUTH` · `DISCONNECTED` (a sign-in not yet activated lives only in the cookie) |
| `health_checked_at`, `health_code` | Last job result as a code (`TOKEN_EXPIRED`, `WEBHOOK_SILENT`, ...) |

`credentials_encrypted` keeps holding the token set (`{ access_token, refresh_token?, kind: "user" | "system_user" | "api_key" }`).

**New `ConnectionResource`** (`connection_resources`, document collection):

| Field | Purpose |
|---|---|
| `id`, `tenant_id`, `connection_id` | Ownership; every lookup filters by tenant |
| `kind` | `FB_PAGE` · `IG_ACCOUNT` · `AD_ACCOUNT` · `WA_NUMBER` · `COURIER_STORE` |
| `external_id`, `name`, `metadata` | From the provider (currency for ad accounts, username for IG) |
| `token_encrypted?` | Only for resources with their own token (Page) |
| `status` | `ACTIVE` · `NEEDS_ATTENTION` · `DETACHED` |
| `activated_at`, `last_event_at` | Webhook subscription done; last inbound event (health) |

Uniqueness: one ACTIVE resource per `(kind, external_id)` across all tenants for `FB_PAGE`, `IG_ACCOUNT`, `WA_NUMBER` (keeps H5);
`AD_ACCOUNT` may be shared (Meta enforces access).

**Other changes:** `ConnectedChannel.resource_id?`; tenant setting `ads.ad_account_resource_id`; `ConnectorConfigRecord` for `meta_graph`
manual rows is read-only after P5.

**Store work** (per `.agent/workflows/database-change.md`): add `connection_resources` to `DatabaseSchema`, accessors in
`src/infrastructure/db/index.ts` (`getConnectionResources(tenantId, connectionId)`, `findActiveResourceByExternalId(kind, id)`, create /
update), tenant-row loading for zero-hydration routes, and `npm run test:pg` round trip. No SQL migration: both collections are documents.

## 7. API

| Route | Method | Permission | Purpose |
|---|---|---|---|
| `/api/v1/connections/{provider}/start` | POST | `social.channel.manage` or `settings.update` (per manifest) | Signed state + nonce cookie; returns dialog URL. Optional `scopes: "ads"` for incremental consent |
| `/api/v1/connections/{provider}/callback` | GET | session | Exchanges the code and puts the token set in the encrypted, httpOnly, 15-minute pending cookie (as today). **Writes nothing to the store** (rule 9); redirects to the picker with `step=pick` / `error=CODE` |
| `/api/v1/connections/{provider}/pending/resources` | GET | same as start | Provider resources for the picker, read with the pending token (live list, no tokens) plus which are already used here / elsewhere |
| `/api/v1/connections/{provider}/activate` | POST | same | Creates or updates the connection from the pending token (owner, scopes from `debug_token`, expiry), activates the picked resources (subscribe webhooks, channels, bindings), clears the cookie |
| `/api/v1/connections/{id}` | GET / DELETE | read / update | Detail drawer; disconnect (revoke at provider, delete tokens, detach resources, pause channels) |
| `/api/v1/connections/{id}/check` | POST | update | Run the health check now |
| `/api/v1/connections/meta/deauthorize` | POST | Meta `signed_request` | Sets NEEDS_REAUTH for that FB user's connections |
| `/api/v1/connections/meta/data-deletion` | POST | Meta `signed_request` | Starts deletion, returns `{ url, confirmation_code }` |
| `/api/v1/connections/meta/data-deletion/{code}` | GET | public, code only | Deletion status page Meta links to |

Existing `/api/v1/social/meta/*` routes stay as thin wrappers for one release, then are removed (P5).
All handlers: canonical pattern, `withStore`, strict Zod, `tenant_id` from context only.

## 8. Phases

Sizes: S ≤ 2 days, M ≤ 1 week, L ≤ 2 weeks (one engineer).

### P0. Decision and foundations (S)
1. ADR-119 in `.agent/DECISIONS.md` with E1–E9.
2. Types: `ConnectionStatus`, `AuthMethod`, `ConnectionResource`, `ResourceKind` in `src/types/connector.ts`.
3. Store: `connection_resources` collection + accessors + tenant-row loading; `test:pg` round trip.
4. Manifest: add `auth_method`, `base_scopes`, `optional_scopes: { feature: string; scopes: string[] }[]`, `resource_kinds` to
   `src/domains/connectors/manifests/*.ts`; catalog snapshot test updated.

**Tests:** store accessors filter by tenant; uniqueness of FB_PAGE across tenants; PG round trip identical.
**Acceptance:** type-check 0, `npm test` and `npm run test:pg` green, no behavior change. **Rollback:** revert; new collection is empty.

**P0 status (2026-10-20): done.** ADR-119; `ConnectorAuthMethod`, `ConnectionResourceKind` (adds `TELEGRAM_BOT` and `SHOP`
to the kinds above), `ConnectionStatus`, `ConnectionResource` and the new optional connection fields in `src/types/connector.ts`;
every manifest declares `auth_method` and `resource_kinds` (sign-in providers also `base_scopes`, Meta `optional_scopes` for ads);
`connection_resources` with `getConnectionResources`, `findConnectionResource`, `findLiveConnectionResourcesByExternalId`,
`createConnectionResource`, `updateConnectionResource`, `deleteConnectionResources` (the store refuses a second live Page /
Instagram / WhatsApp / Telegram resource in any workspace, and any duplicate within one); deleting a connector deletes its
resources; key rotation covers resource tokens; suite `tests/connection-resources-tests.ts`. Known gap until P1/P3: the Meta login
still asks `ads_read` up front (its scope list is not read from the manifest yet).

### P1. OAuth broker + Meta adapter (M)
1. `src/domains/connectors/auth/oauth-broker.ts`: start (signed state bound to tenant + user + nonce + provider + requested scopes),
   callback (nonce check, exchange, inspect, upsert connection), popup hand-off (reuse `meta-login-popup.ts`, generalise the message to
   `{ provider, query }`).
2. `auth/meta.adapter.ts`: move `graph()`, `fetchPages`, `fetchAdAccounts`, `subscribed_apps` from `meta-login.service.ts`.
   `inspect` uses `/debug_token` (app token) for scopes and expiry.
3. Between callback and pick the token stays in the pending cookie (GET writes nothing, rule 9). The connection is created by the
   activate POST. Incremental consent (P3) uses the same path: the new token replaces the connection's token on activate, only if Meta's
   `debug_token` says it belongs to the same Facebook user as the existing connection.
4. Routes in §7 for start / callback / pending resources / activate; `/social/meta/connect|pages|oauth/callback` delegate to them.

**Tests:** existing `meta-login-tests.ts` cases ported (state replay, other browser, other workspace, cancelled dialog, cross-tenant Page
refused, tokens never in responses); new: callback leaves the store unchanged; scopes recorded from `debug_token`, not from the request;
a token from another Facebook user can't replace an existing connection's token.
**Acceptance:** the current Connect with Facebook flow works unchanged from the UI. **Rollback:** wrappers point back to the old service.

**P1 status (2026-10-20): done.** `src/domains/connectors/auth/` (`types.ts`, `meta.adapter.ts`, `oauth-broker.ts`,
`callback-handler.ts`, `resource-pickers.ts`); routes `/api/v1/connections/{provider}/start|callback|pending/resources|activate`;
the generic signed state (`signOAuthState`, audience `commerceos:connection-oauth`, carries provider + features) replaces the
Meta-only one; cookies on path `/api/v1`. Activate inspects the token with `/debug_token` (must be valid and issued to our app)
and saves one `connector_configurations` row per workspace + Facebook user (owner, granted scopes, expiry, token encrypted,
audited). Channels now record only `adAccountId` and `adsConnectionId`; Ad Manager reads the token from that connection
(channels saved by the first ad-account release still carry a token and are read as before until P2's migration). The
old `/social/meta/connect|pages|oauth/callback` routes are removed (the UI calls the new ones; cookies are scoped to
`/api/v1/connections`). Connector Hub refuses pasted credentials for providers with a sign-in adapter. Scopes come from the manifest; the UI still
asks the `ads` feature at sign-in until P3. Deviation: no PENDING connection (the token waits in the cookie; see §11).

### P2. Resources and bindings (M)
1. Picker becomes generic: `GET/POST /connections/{id}/resources` render Pages, IG accounts, ad accounts by `kind`.
2. Activating `FB_PAGE` / `IG_ACCOUNT`: subscribe webhooks, create or refresh the channel with `resource_id`; Page token stored on the
   resource. Channels read the token via `ChannelService.getCredentials(channel)` → resource → (fallback) old `credentials_encrypted`.
3. `AD_ACCOUNT`: binding `ads.ad_account_resource_id`; Ad Manager reads `resolveCapability(ctx, "ADS_READ")` → connection user token +
   ad account id. Remove `adsToken`/`adAccountId` from channel credentials (today's stopgap).
4. Data script `scripts/migrate-channels-to-connections.ts` (dry run by default, backup first, refuses while the app writes): for each
   `connectedVia: "facebook_login"` channel create connection + resources, set `resource_id`; manual-token channels get a connection with
   `auth_method: api_key`, `owner_user_id: connectedBy`.

**Tests:** webhook routing still finds the tenant by Page id; sending uses the resource token; Ad Manager reads only its tenant's binding;
migration is idempotent and the PG round trip matches. **Acceptance:** inbox, comment triggers, Engagement and Ad Manager work on migrated
data. **Rollback:** channels still have `credentials_encrypted` for one release.

**P2 status (2026-10-20): done, migration not yet run on real data.** `src/domains/connectors/resources.ts`
(`upsertConnectionResource`, `bindAdAccount`, `resourceToken`, `resolveAdsAccess`); Connect with Facebook saves each Page /
Instagram account as a resource holding the Page token, and the channel's `resource_id` points at it; `getDecryptedCredentials`
prefers the resource's token; deleting a channel detaches its resource (frees the Page for another workspace). Deviations: the ad
binding is "the workspace's one live AD_ACCOUNT resource" (picking another detaches the first) instead of a tenant setting; the
channel keeps writing its own Page-token copy for one release (rollback); pasted-token channels are not migrated (they reconnect
with Facebook in P5). Migration: `src/domains/connectors/migrate-channels.ts`, script
`scripts/migrate-channels-to-connections.ts` (dry run by default, backup before `--apply`, idempotent, never calls Meta).

### P3. Least privilege and incremental consent (S–M)
1. Meta `base_scopes`: `pages_show_list, pages_manage_metadata, pages_read_engagement, pages_messaging, instagram_basic,
   instagram_manage_messages, instagram_manage_comments, pages_read_user_content`. `business_management` only if a resource needs it
   (check: Pages owned by a Business Manager list without it?).
2. Ad Manager "Connect ads" button → `start?scopes=ads` → popup asks only `ads_read` (Meta keeps earlier grants) → pick ad account.
3. `missing_permissions` split into required vs optional; optional ones show as "Not enabled" next to the feature, not as a warning.

**Tests:** start URL scopes per feature; Ad Manager without `ads_read` shows a "Connect ads" state, no Graph call.
**Acceptance:** first connect asks only base scopes. **Rollback:** manifest change only.

**P3 status (2026-10-20): done except step 1.** Connect with Facebook (connector card, picker) asks only the base scopes;
Ad Manager's "Connect ads" button opens the popup with the `ads` feature, so Facebook asks `ads_read` then. The picker lists
ad accounts only for that sign-in (`ads: { requested, granted }`), can save just an ad account without touching Pages, and
`missing_permissions` lists required scopes only. Not done: step 1 (dropping `business_management` from the base scopes) needs
a check against a real Meta app first.

### P4. Health, expiry, revocation (M)
1. Job `connection-health` (existing scheduled-jobs runner): per connection every 6 h — `adapter.inspect` (token valid, scopes, expiry),
   `adapter.check`, webhook freshness from `resource.last_event_at`. Writes `connection_status`, `health_code`, `health_checked_at`.
2. Token rejected (Meta code 190) anywhere at runtime → mark NEEDS_REAUTH in the same unit as the failed action's audit (via
   `db.keepEvenIfRequestFails`).
3. E8: `removeMembership` → connections with that `owner_user_id` → delete token, NEEDS_REAUTH, audit, notify owner.
4. Meta deauthorize + data-deletion endpoints (verify `signed_request` HMAC with `META_APP_SECRET`, constant-time).
5. Disconnect: revoke at provider (`DELETE /me/permissions` for Meta), delete tokens, detach resources, pause channels, audit.
6. Notifications: owner gets "Reconnect Facebook" 7 days before expiry and on NEEDS_REAUTH.

**Tests:** expired token → DEGRADED then NEEDS_REAUTH; member removal clears the token; forged `signed_request` refused; GETs write nothing
(`phase2-readonly`); disconnect leaves no token anywhere (scan of the tenant's records). **Acceptance:** a revoked app on Meta shows
"Reconnect" within one job cycle. **Rollback:** job behind a platform flag `connection_health_job`.

**P4 status (2026-10-20): done except step 6 (notifications).** `src/domains/connectors/connection-lifecycle.ts`; job
`connection-health` (6 h); E8 on suspend / role change / removal; routes `/api/v1/connections/meta/deauthorize`,
`/data-deletion`, `/data-deletion/{code}` (stateless signed status code); best-effort `DELETE /me/permissions` on disconnect when no
other workspace uses the same login. Deviations: a token rejected at runtime (e.g. by Ad Manager's GET) is not marked from that
request (GETs never write); the next health run marks it, and an expired token gives no token immediately (`token_expires_at`).
No platform flag for the job yet; webhook-silence detection not done (quiet Pages are normal). Meta app URLs: `docs/render-runbook.md`.

### P5. Other auth methods on the same model (M–L)
1. **WhatsApp Embedded Signup** (`embedded_signup`): Meta JS SDK popup → code → `/connections/whatsapp/exchange` → WABA + phone number
   resources → register webhook. Replaces the pasted-token form (keeps FX-50 send work).
2. **Telegram** (`bot_token`): form → `getMe` → connection + `BOT` resource → webhook set automatically (today's buttons removed).
3. **Couriers / payments** (`api_key`): unchanged form; becomes a connection with one `COURIER_STORE` resource; feeds C2 booking.
4. Remove the `meta_graph` manual connector from the catalog (existing rows read-only, then migrated in P2's script) and the
   `/social/meta/*` wrappers.

**Tests:** each method's happy path and its failure codes with stubbed transports; catalog snapshot. **Acceptance:** no OAuth-capable
provider shows a token field. **Rollback:** per-provider manifest `status: COMING_SOON`.

**P5 status (2026-10-20): done, not verified with Meta.** WhatsApp uses the broker's redirect flow with the Meta app's Embedded
Signup configuration (`META_WA_CONFIG_ID`) instead of the JS SDK popup: the WABA ids come from Meta's token inspection
(granular scopes), never from the browser; picker `/connector/whatsapp`; the number is registered when the merchant gives its
two-step PIN (used once, never stored), otherwise reported "not registered". The WhatsApp channel stores no token: it reads the
connection's through its WA_NUMBER resource. Telegram and courier connectors saved in the hub now record `auth_method`, owner
and their bot / store resource; their credentials stay in the connector (no generic credential migration). Meta and WhatsApp
manifests have no form fields; the hub refuses pasted credentials for them. Not done: TikTok / Google Ads adapters (still
COMING_SOON).

### P6. Connector page and operations (M)
1. Page grouped by goal: **Sell & chat** (Facebook/Instagram, WhatsApp, Telegram, website chat), **Deliver** (couriers), **Get paid**
   (bKash, Nagad), **Ads & growth** (Ad Manager, Google Ads). LLM / vector / infra cards move to super-admin only.
2. Card = provider + status chip from `connection_status` (Active · last event 3 min ago / Reconnect needed / Expires in 5 days / Not
   connected) + one primary action chosen by `auth_method`. No provider-id branches in the page (`META_PROVIDER_ID` removed).
3. Detail drawer: resources and bindings, scopes granted vs available, owner, expiry, last event, Reconnect, Add permission, Disconnect.
4. Super-admin: cross-tenant health view (counts by status and `health_code`, no tokens), platform-app settings readiness
   (`META_APP_ID` set, redirect URI, App Review status as a manual field).
5. Six UX states per `.agent/rules/ux.md`; design tokens only; mobile width.

**Tests:** page renders from manifests (no hard-coded provider list); browser check of each flow with stubbed API.
**Acceptance:** a merchant connects Facebook, picks a Page and an ad account, and sees real status, without seeing a token.

**P6 status (2026-10-20): done in part.** Manifests carry a `goal`; the store view's tabs are All / Sell & chat / Deliver / Ads &
growth (infrastructure stays in the admin INFRA view, not moved to super-admin yet). Cards show status from
`GET /api/v1/connections` (connection status and channel activity: "Active · last message 5 min ago", "Expires in 3 days",
"Needs attention", "Reconnect needed"); a provider with connections opens a detail drawer (who connected it, access expiry,
permissions not granted, optional features with "Allow", Pages / numbers with last message, Reconnect, Disconnect with a
confirm step). Super-admin Insights has a "Sign-in connections" card (`GET /api/v1/platform/connections/health`, counts only,
plus Meta app readiness). Not done: removing the provider-id branches entirely (`SIGN_IN_CARDS` maps two ids to their popup),
moving AI / vector cards out of the merchant app, an App Review status field.

## 9. Cross-cutting

- **Security:** tokens encrypted with the existing `encryptCredential` (add key version for rotation in P4); never in responses, logs,
  audit metadata or URLs; `appsecret_proof` on every Meta call; state signed with a per-purpose audience; `tenant_id` from context only;
  every mutation calls `assertCan`; run `security-reviewer` after P1, P2, P4 and `/platform-security-review` before P6 ships the
  super-admin view.
- **Truthfulness:** a connection is ACTIVE only after the provider answered; activation results per resource (`CONNECTED_NO_WEBHOOKS`
  stays); simulated providers keep `SIMULATED` / `NOT_VERIFIED`.
- **Testing:** stubbed transports per adapter (`setOutboundTransportForTesting`), contract fixtures recorded from sandbox apps, every
  suite also under `npm run test:pg`; `smoke-security.mjs` gains forged `signed_request` and replayed-state cases.
- **Observability:** `connection.status_changed`, `connection.token_rejected`, `connection.resource_activated` events with codes, no
  payloads; metrics by provider and status in the super-admin view.
- **Rollout:** each phase behind platform flag `connections_v2` per workspace; shadow-read (compare old vs new credential resolution and log
  differences) for one week before switching reads in P2.
- **Docs:** STATUS.md row per phase; `.env.example` gains only placeholders; `docs/render-runbook.md` gets the Meta app setup
  (redirect URIs, webhook URL, deauthorize / data-deletion URLs, App Review checklist).

## 10. Schedule (one engineer, sequential)

| Week | Work |
|---|---|
| 1 | P0, start P1 |
| 2 | P1 done; first live test with your own Page on a Meta app in development mode |
| 3–4 | P2 including migration script and shadow reads |
| 4 | P3 |
| 5 | P4 (health, revoke, Meta callbacks) → submit Meta App Review (review itself takes 1–4 weeks, outside our control) |
| 6–7 | P5 (WhatsApp Embedded Signup first, then Telegram, couriers) |
| 8 | P6 page and super-admin view |

P5 and P6 can run in parallel with a second engineer once P2 lands.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Meta App Review rejects a permission | P3 shrinks the list; each permission maps to one screen-recordable feature; keep development-mode testing with app roles meanwhile |
| Migration breaks inbound webhooks (tenant routing by Page id) | Shadow reads, `resource_id` fallback to old credentials for one release, migration dry run on a Neon branch |
| Pending token in a cookie is lost if the merchant switches browser mid-flow | Accepted: they sign in again; keeps GET read-only (rule 9) and no half-made connections in the store |
| Long-lived user tokens still expire (~60 days) | P4 warnings + Reconnect; evaluate System User tokens via Business Manager for merchants who agree (no expiry, narrower) |
| Scope creep into a full iPaaS | Non-goals in §2; enterprise systems stay `COMING_SOON` |

## 12. What I need from you

1. A Meta app (Business type) in development mode, with you as admin, plus a test Page and test ad account; redirect URI for local
   (`http://localhost:3000/api/v1/connections/meta/callback`; keep the current `/api/v1/social/meta/oauth/callback` registered too until P5) and staging.
2. Whether Ad Manager should support System User tokens for agencies (adds a small `api_key`-style path for `ADS_READ`).
3. Business Verification started on the Meta Business account (needed for Advanced Access).
