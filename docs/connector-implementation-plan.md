# Connectors: from a hardcoded catalog to dynamic, working integrations

**Status:** plan, no code changed · **Date:** 2026-10-01 · **Basis:** reading `src/domains/connectors/**`, `src/types/connector.ts`,
the social channel adapters, the courier and shipping services, and `.agent/STATUS.md`. Nothing was run against a live provider.

## 1. What "hardcoded" means today (and what does not need to change)

| Layer | Today | Verdict |
|---|---|---|
| Catalog (38 providers: names, fields, setup steps, docs) | One 1,685-line file, `if (provider.id === ...)` branches | Hardcoded. Make it modular and manifest-driven |
| Saving credentials | Per workspace, encrypted, masked, audit-logged | Already real. Keep |
| Live check | 17 providers make a real HTTP call (`live-checks.ts`); 21 answer `NOT_VERIFIED` | Half done |
| **Doing the actual work** | LLM, vectors, Redis and DB use **server env vars**; no courier API; Telegram sends nothing; social send unverified | **The real gap** |

So "dynamic" has three parts, in this order of importance:
1. **Functional:** a saved connector must actually be used by the feature it belongs to (book a parcel, send a Telegram alert, use the tenant's own LLM key).
2. **Data-driven:** providers described by manifests and handled by drivers, instead of `if/else` on provider ids.
3. **Honest:** a connector that cannot work from a hosted service is removed or labelled, never shown as connectable.

## 2. Rules every phase keeps (from AGENTS.md)

Tenant comes from the session only · `assertCan` on every mutation · every external call through `outboundRequest` (SSRF guard) ·
simulated or unverified results say `SIMULATED` / `NOT_VERIFIED` / `NOT_SENT`, never success · no fabricated metrics ·
no default or shared secrets · tests never call a live provider (stubbed transport) · GET handlers never write.

## 3. Target design

```
Feature code (shipping, messaging, AI, sync)
        │  asks for a capability, never for a provider name
        ▼
ConnectorRuntime.resolve(ctx, "COURIER")  ──>  tenant's connector (decrypted in memory only) ──> Driver
        │                                         else platform default (only where policy allows)
        ▼
Driver  = { manifest, capabilities, check(creds), actions }      one file per provider
        │
        ▼
Execution wrapper: kill-switch gate → rate limit → circuit breaker → outboundRequest → retry/backoff → dead letter
                   → audit row + health update (never logs credentials or message bodies)
```

- **Manifest** (typed object, one per provider): id, name, category, capabilities, credential fields (with validators), setup guide,
  `status: "LIVE" | "BETA" | "COMING_SOON"`, `requiresPlan`. The UI renders forms from it; the platform control plane can hide a provider with a feature flag without a deploy.
- **Capabilities:** `LLM_CHAT`, `EMBEDDINGS`, `VECTOR_STORE`, `MESSAGING`, `COURIER`, `PAYMENT`, `CACHE`, `CRM_SYNC`, `CATALOG_IMPORT`.
  Each capability has one TypeScript interface (for example `CourierDriver.createParcel / track / cancel / balance`), so a new courier is one file.
- **Credentials:** keep the encrypted store. Remove every default secret (the Telegram webhook secret default is a public constant today); generate per-connector webhook secrets, show once, support rotation.
- **Inbound webhooks:** one generic route `/api/v1/connectors/<id>/webhook` with a per-connector secret, signature check, replay window and dedup (reusing the existing courier/payment webhook machinery).
- **Resilience reuse:** the repo already has `provider-circuit-breaker`, `retry-queue`, `dead-letter`, `idempotency` services. Drivers use them; do not write new ones.
- **Health:** a scheduled sweep (needs the job queue, R1b in `production-readiness.md`) updates `health_status`; until then health updates on test and on each real call result.

## 4. Decide first: keep, build or prune

Several providers cannot work from a hosted service by design. Recommendation per provider:

| Provider(s) | Today | Recommendation |
|---|---|---|
| Steadfast | live check only | **Build** (C2) |
| Pathao | no check | **Build** (C2) |
| RedX, Paperfly, eCourier | no check | **Build** after Pathao if the merchants use them; else `COMING_SOON` |
| DHL Express | no check | `COMING_SOON` (international; low priority) |
| Telegram | live check only | **Build** (C3) |
| WhatsApp Cloud, Meta Graph (FB/IG) | live check; send unverified | **Verify and finish** (C3) |
| TikTok Shop, Google Ads | no check | `COMING_SOON` (heavy OAuth and app review) |
| OpenAI, Anthropic, Gemini, DeepSeek, Groq, OpenRouter, Ollama, vLLM | live check; app ignores them | **Build** per-tenant LLM override (C4). Ollama and vLLM stay platform-only (private network) |
| Qdrant, Pinecone | live check; app uses env only | **Build** optional bring-your-own (C4) or remove tenant entries |
| Chroma, Milvus | no check | Remove or `COMING_SOON` |
| pgvector dedicated, Supabase, Neon, self-hosted Postgres and MySQL | no live check (TCP, not HTTP) | **Prune**: a hosted service must not open arbitrary database connections from tenant input |
| Upstash Redis | live check; unused | Keep only if a feature uses it (rate limits already use Postgres); else prune |
| Redis self-hosted and Redis Cloud | TCP | **Prune** |
| HubSpot, Shopify Plus | live check | **Build** sync (C5), one at a time |
| Google Sheets | real fetch for product import | Keep; fold into the driver model (C5) |
| Daraz | no check | `COMING_SOON` until an API contract is confirmed |
| SAP S/4HANA, NetSuite, Salesforce | no check | `COMING_SOON`; serve the long tail through n8n workflows rather than custom drivers |

Pruning is not a loss of function: those entries cannot work today. It removes false promises and the largest SSRF and credential-handling surface.

## 5. Phases

Each phase is its own branch and pull request, with a way to verify and a rollback. Sizes: S ≤ 2 days, M ≤ 1 week, L ≥ 1 week.

### C0. Foundations, no behavior change (M)
- Introduce `ConnectorDriver`, the manifest type and the capability interfaces; move the 38 definitions out of `service.ts` into one manifest file per provider and a registry; `service.ts` shrinks to orchestration.
- Characterization tests first: snapshot the current provider list, fields and live-check requests, so the refactor is provably neutral.
- Replace the default secrets (Telegram `webhook_secret`) with a generated per-connector secret.
- Add `status: LIVE | BETA | COMING_SOON` to the manifest; hide `COMING_SOON` and pruned providers in the UI and reject saving them in the API.
- Persist the last test result honestly (already partly done).
**Accept:** the connectors tests and the new characterization tests pass unchanged; the catalog API returns the same providers except the pruned ones; no default secret remains in the repo.
**Rollback:** revert the PR; stored records keep their ids.

### C1. Verification coverage (S–M)
Add live checks for providers kept as LIVE that lack one (Pathao token request, RedX, Paperfly, eCourier, Chroma if kept). Providers with no feasible check are `COMING_SOON`, not `NOT_VERIFIED`.
**Accept:** every provider shown as connectable has a live check or is labelled; tests use the stubbed transport.

### C2. Couriers that actually book parcels (L)
- `CourierDriver` for Steadfast first: create parcel, track, cancel, balance, signed status webhook, mapping into the existing `courier-sync` status table.
- `shipping.service` calls the tenant's courier connector when one is verified; falls back to today's manual tracking-number entry when not (and says so).
- Idempotent booking (the order id is the key), retry with the circuit breaker, dead-letter on repeated failure, COD amount and RTO hooks.
- Then Pathao (OAuth token cache with expiry, city and zone lookup), then others as `BETA`.
**Accept:** with the stubbed courier, an order creates exactly one parcel even on a retry; a courier outage opens the breaker and the UI shows the manual path; webhooks update the order only through `OrderLifecycleService`.
**Verify live:** a Steadfast sandbox or a real low-value test parcel, by you. **Rollback:** feature flag per tenant `connectors.couriers`.

### C3. Messaging that actually sends and receives (L)
- **Telegram:** `MessagingDriver` with `sendMessage` (Bot API, HTML escaped), `setWebhook` with a generated `secret_token`, an inbound route that verifies `X-Telegram-Bot-Api-Secret-Token`, and mapping into conversations. Replace the `TelegramMarketingAdapter` stub and the Facebook-adapter stand-in.
- **WhatsApp Cloud and Meta Graph:** finish and verify send/receive with a Meta test number: 24-hour window, template messages, media, delivery receipts, per-entry signature checks (already built).
- Marketing sends respect consent and frequency caps (already enforced) and report `SENT` only on the provider's accepted response.
**Accept:** stubbed provider tests for success, rate limit, blocked user and revoked token; a revoked token flips the connector to `ERROR` and stops retries; nothing claims `SENT` otherwise.
**Verify live:** a real Telegram bot and a Meta test number, by you.

### C4. Bring-your-own AI and vectors (M–L)
- `ModelRouter` resolves a per-tenant LLM connector (BYO key) before the platform default, with the platform default only for plans that include it; per-tenant token and cost budgets (also closes P1-4 in the readiness audit); tenant provider kill switch already exists.
- Embeddings and Qdrant: a tenant may bring its own Qdrant endpoint (https only, standard ports, via the guard) or use the platform one with the existing tenant filter. Changing the embedding model requires re-indexing, so the UI warns and blocks mixed dimensions.
**Accept:** two tenants with different keys never share a client, cache or budget; a tenant key is never logged; cost shown comes from provider-reported usage.

### C5. Commerce sync (M each)
HubSpot contacts and orders, Shopify products and orders (webhook plus periodic pull), Google Sheets as a `CATALOG_IMPORT` driver. One provider per PR, behind a flag, using the job queue for pulls. The long tail (SAP, NetSuite, Salesforce, Daraz) is offered as n8n workflow templates, not drivers.

### C6. Dynamic UI and operations (M)
- Forms, guides and status rendered from the manifest; "test before save", masked fields, rotate-secret action, last-checked time, last error code, and a one-click disable.
- Health sweep job, alert on `ERROR` (notification to the workspace owner), and a super-admin view of connector health across tenants.
- Docs: one page per provider generated from the manifest.

## 6. Testing strategy

- **Unit and contract tests per driver** with the stubbed outbound transport and recorded response fixtures (success, 401, 429, 5xx, timeout, malformed body). No live call in CI.
- **Tenant isolation tests:** a tenant can never resolve, test, use or list another tenant's connector or secret.
- **Security tests:** SSRF (private IPs, redirects, DNS rebinding stubs), secrets absent from logs and API responses, webhook replay and forged signatures.
- **Truthfulness tests:** every failure path yields `FAILED`, `NOT_SENT` or `NOT_VERIFIED`, never success.
- **Manual live checklist** per provider (sandbox account, one real call), recorded in `.agent/STATUS.md` before a provider is marked `LIVE`.

## 7. Order and dependencies

C0 → C1 → C2 (Steadfast) → C3 (Telegram, then Meta) → C4 → C2 (Pathao and others) → C5 → C6.
C3 retries and C6 health sweeps want the job queue from the readiness plan (R1b); until it exists, retries use the existing in-process retry service and health updates only happen on test and call results.
Rough total: C0 M, C1 S, C2 L, C3 L, C4 M–L, C5 M per provider, C6 M.

## 8. Decisions needed from you

1. **Prune list:** agree to remove self-hosted/TCP database and Redis connectors, Chroma and Milvus, and to mark TikTok, Google Ads, DHL, Daraz, SAP, NetSuite and Salesforce `COMING_SOON`?
2. **Which couriers do your merchants really use?** (decides C2 beyond Steadfast and Pathao.)
3. **Platform default vs bring-your-own for LLM and vectors:** does a tenant pay for the platform's key, or must it bring its own? (decides budgets and plan gating.)
4. **Sandbox access:** Steadfast, Pathao, a Telegram bot, a Meta test number and a WhatsApp test number for live verification. Without them a provider stays `BETA`.
5. **Telegram scope:** only merchant alerts, or customer conversations too?
