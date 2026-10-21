# Feature Specification: Image Product Search in Customer Chat

## 1. Executive Summary
- **Feature Name**: Image product search ("ei product ta ache?" with a photo)
- **Target Persona**: Customers messaging a shop on Facebook Messenger, Instagram, WhatsApp and Telegram; the merchant's support team who review the agent's replies
- **Owner / Author**: CommerceOS owner (spec drafted 2026-10-19)
- **Status**: Draft — needs owner decisions in §8 before implementation
- **Target Release**: Customer-agent track, after the Stage 2 channel work; staged as phases P1–P4 (§6)
- **Decision record**: ADR-117 in `.agent/DECISIONS.md`

---

## 2. Problem Statement & Business Justification

In Bangladeshi f-commerce a large share of first messages is a photo: a screenshot of the shop's own post or ad, a
photo from another shop, or a picture of something the customer saw. The text is usually short ("ache?", "price koto?",
"eta lagbe") or missing.

### What happens today (verified in code, 2026-10-19; re-checked 2026-10-20 after n8n was removed, ADR-118)

Since ADR-118 there is one inbound path: the channel webhook → adapter → `WebhookIngressService` → `enqueueCustomerTurn`.
`/api/v1/social/ingest` and the n8n envelope are gone, so the adapters are the only place images need to be normalised.

| Step | Behaviour | Where |
|---|---|---|
| Telegram inbound | A photo message has `photo` + `caption`, not `text`, so `normalizeIncomingEvent` returns `[]` and the message is dropped | `src/domains/social/channels/adapters/telegram.adapter.ts` (`typeof text !== "string"` guard) |
| WhatsApp inbound | Image recorded as `https://graph.facebook.com/v21.0/<media_id>`: that is a metadata URL that needs the access token, not a downloadable image | `whatsapp.adapter.ts` (`type === "image"` branch) |
| Messenger / Instagram inbound | Attachment `payload.url` kept (a short-lived Meta CDN URL) | `facebook.adapter.ts`, `instagram.adapter.ts` |
| Persisting | `MessageService.processInboundMessage` saves `message_type` but drops `attachments`; nothing writes the `attachments` collection | `src/domains/social/messages/message.service.ts` |
| Agent turn | A customer message with empty text ends the turn with `NOTHING_TO_ANSWER` — no reply, no handoff | `src/domains/ai/customer-agent/runtime.ts` (`!last.text?.trim()`) |
| Model call | `LLMMessage.content` is a string; no image parts | `src/domains/ai/providers/llm-provider.interface.ts` |
| Product search | `search_products` matches query tokens against name / SKU / short description only | `src/domains/ai/customer-agent/tools.ts` |
| Storage | No object storage for media exists in the codebase | — |

Net result: **a photo-only message gets silence**, and a photo with a caption is answered from the caption alone.

### KPIs
- Share of image-bearing inbound messages that get a reply or a human handoff within SLA (target: 100% — silence is the bug).
- Precision of "yes, this is our product X" answers on the image eval set (target ≥ 95% at the auto-answer threshold; recall may be lower — asking is cheaper than a wrong match).
- Order conversion of conversations that started with an image vs. today's baseline.
- Human handoff rate for image messages (should fall in P3 vs. P1, without lowering precision).

---

## 3. Scope & Requirements

### In scope
- Inbound images (JPEG/PNG/WebP; first frame of a GIF is out of scope) on Messenger, Instagram, WhatsApp, Telegram.
- Matching an image to **this tenant's active catalog** and answering availability, price, variants from tools.
- Sending the matched product's own catalog image back for confirmation.
- Recognising non-product images (payment screenshots, selfies, documents) and routing them correctly.

### Out of scope (this spec)
- Video, voice notes, stickers.
- Searching other shops or the web for the item.
- Automatically verifying bKash/Nagad payment screenshots (payments stay deterministic, governed by the payment flow).
- Image generation or editing.

### User stories & acceptance criteria

**US-1 — No silent drops.** As a customer, when I send only a photo, I always get a response.
- [ ] Given image-search is off for the workspace, when a customer sends an image with no text, then the agent sends a short acknowledgement in the customer's script and hands the conversation to a human (existing handoff path), and the inbox shows the image.
- [ ] Given a Telegram photo with or without a caption, then a message is created with `message_type = "IMAGE"` and the caption as text.

**US-2 — Exact match.** As a customer, when I send a photo or screenshot of a product the shop sells, the agent tells me it is available with the real price.
- [ ] Given one catalog product scores above the high-confidence threshold and clearly above the runner-up, when the turn runs, then the reply names that product, takes price and stock only from `get_product` / `quote_order` results, and attaches the product's `primary_image` (or first of `images`) so the customer can confirm.
- [ ] Price, stock, delivery fee and payment state never come from the model's reading of the image (amounts guard in `runtime.ts` stays in force).

**US-3 — Ambiguous match.** As a customer, when my photo looks like several products, the agent asks which one.
- [ ] Given 2–3 candidates in the medium band, then the reply lists them (name + image each, max 3) and asks the customer to choose; it does not state that any one of them is "the" product.

**US-4 — Not ours.** As a customer, when the shop doesn't sell the item, I'm told honestly.
- [ ] Given no candidate above the low threshold, then the reply says this exact item isn't available, may suggest up to 3 products from the same detected category, and never claims availability.

**US-5 — Screenshot of the shop's own post/ad.** 
- [ ] Given the image is a screenshot containing a product code / SKU or a price visible in the image, then the extracted code is looked up exactly (SKU match beats visual similarity); a price read from the image is never quoted back — the catalog price is.

**US-6 — Non-product images.**
- [ ] Given a payment screenshot, then no payment state changes; the conversation is handed to a human with reason `PAYMENT_PROOF`.
- [ ] Given an image classified as a person/ID document/other, then the agent asks what product the customer is looking for (or hands off), and the image is not sent to the image-embedding index.

**US-7 — Merchant review.** As a merchant, I can see what the agent "saw".
- [ ] The inbox shows the image, the detected attributes and the candidate products with scores (agent-draft / shadow view), so a reviewer can rate it with the existing shadow rating.

**US-8 — Catalog indexing.** As a merchant, my product photos become searchable without extra work.
- [ ] When a product's images change (create, update, bulk import), its image vectors are (re)computed by a background job; when a product is archived/deleted, its vectors are removed. No GET request writes vectors.

---

## 4. Architecture & Technical Design

### 4.1 Flow

```
channel webhook ─► adapter.normalizeIncomingEvent  (attachment ref: provider + media id/url)
              ─► MessageService.processInboundMessage  (message + attachments rows, status PENDING_FETCH)
              ─► enqueueCustomerTurn (existing debounce)
customer-agent worker (outside the store lock, ADR-112):
   1. MediaFetchService      download via outboundRequest → validate → re-encode → object storage
   2. ImageUnderstanding      vision model → strict JSON (kind, category, colors, pattern, text_in_image, sku_candidates)
   3. ImageMatchService       a) exact SKU/code lookup  b) image-vector kNN (tenant filter)  c) attribute search_products
                              → fused, scored candidates (product_id, variant_id, score, reasons)
   4. Turn context            candidates injected as a SYSTEM data block ("image_match"), not as instructions
   5. Existing agent loop     model must call get_product / quote_order for any price or stock it states
   6. Reply                   text + optional catalog image via adapter.sendMediaMessage
```

Key rule: **the model never receives a URL to fetch and never decides what is in stock.** Steps 1–3 are deterministic
services; the model only phrases the answer from tool results.

### 4.2 Affected domains
- `social/channels/adapters/*` — normalise image references per provider (Telegram `photo[]` largest size `file_id` + `caption`; WhatsApp media id kept as id, not URL; Meta CDN URL kept with fetch deadline).
- `social/messages/message.service.ts` — persist `attachments` rows.
- `social/webhooks/webhook-ingress.service.ts` — unchanged apart from passing attachments through; no other ingest route exists (ADR-118).
- New `src/domains/media/` — `media-fetch.service.ts`, `media-storage.ts` (interface + implementation chosen in §8).
- New `src/domains/ai/vision/` — `image-understanding.service.ts`, `image-match.service.ts`, `product-image-index.service.ts`.
- `ai/providers` — multimodal message parts; `LLM_MODEL_VISION` tier in `model-router.ts`; mock provider returns deterministic attributes for demo/tests.
- `ai/customer-agent/runtime.ts` — image-only turns allowed when image-search is on; otherwise acknowledge + handoff.
- `ai/customer-agent/tools.ts` — no new LLM-facing fetch tool; optional `show_product_images(product_ids[])` that sends catalog images only.
- `catalog` — enqueue index job on image change.
- `privacy/customer-erasure.service.ts` — already deletes the `attachments` collection; extend to delete stored objects.

### 4.3 Data model
- `attachments` collection (type `Attachment` exists in `src/types/social.ts`): add `provider_ref` (media id / file_id / CDN URL — never a token), `fetch_status` (`PENDING | STORED | FAILED | SKIPPED`), `sha256`, `analysis` (`{ kind, category, colors[], text_in_image, sku_candidates[] , model, analysed_at }`), `match` (`{ candidates: [{ product_id, variant_id?, score, source }], band: HIGH|MEDIUM|LOW|NONE }`), `expires_at`.
- `product_image_vectors` in the vector store (Qdrant per STATUS), payload `{ tenant_id, product_id, variant_id?, image_hash, model_stamp }`; every query filters by `tenant_id` from the principal. Model stamp handled like text embeddings (FX-82): a different stamp means re-embed.
- JSONB collections need no SQL migration (as ADR-116); any new Postgres table follows `.agent/workflows/database-change.md`.

### 4.4 API contracts
- No new public tenant API in P1–P2.
- P3: `POST /api/v1/catalog/image-index/rebuild` (RBAC `PRODUCTS_WRITE`, rate-limited, enqueues jobs, never runs inline).
- P3: `GET /api/v1/social/conversations/:id/attachments/:attachmentId` returns a short-lived signed URL for the inbox (RBAC `SOCIAL_MESSAGE_READ`, tenant-filtered).

### 4.5 Scoring & bands (initial values; calibrate on the eval set before going live)
| Source | Rule |
|---|---|
| SKU / product code read from image matches an active SKU exactly | band HIGH regardless of visual score |
| Visual kNN top-1 ≥ T_high **and** (top-1 − top-2) ≥ margin | HIGH |
| Top candidates ≥ T_low | MEDIUM (show up to 3) |
| Otherwise | NONE → honest "not available" + category suggestions |

Thresholds live in code constants per model stamp (per AGENTS.md §5.6 business config is not in prompts); tenant
override only if the eval shows a need.

### 4.6 UI impact
- Inbox message bubble renders image thumbnails (signed URL) for inbound/outbound media.
- Agent-draft / shadow panel shows "Agent saw: …" attributes and candidate cards with score bands.
- Catalog: per-product "image search ready / failed / not indexed" badge (P3).
- Follows `.agent/rules/frontend.md`, tokens only; the six UX states for the new panels.

### 4.7 Agent interaction
- System prompt (customer agent) gains a short section: how to use the `image_match` block, never quote amounts seen in images, ask when band is MEDIUM, be honest on NONE. Prompt version bump + eval cases (`.agent/workflows/agent-development.md`).

---

## 5. Security & Multi-Tenancy
- **Tenant scope**: tenant comes from the channel → workspace mapping at webhook ingress; worker re-derives it from the persisted conversation. Vector queries and storage keys are prefixed/filtered by `tenant_id`; no cross-tenant index.
- **SSRF / fetch**: all downloads through `src/lib/outbound-http.ts`; https only; host allow-list per provider (Meta CDN / `graph.facebook.com` / `api.telegram.org`); no redirects except the documented provider media step; deadline and byte cap (≤ 8 MB fetch, policy limit 25 MB already in `policy.service.ts`).
- **Credentials**: WhatsApp media and Telegram `getFile` need the channel token; tokens are never stored in `provider_ref`, logged, or put into URLs we persist. Telegram file URLs embed the bot token — they are used in memory only.
- **Content validation**: magic-byte MIME sniff, decode + re-encode (strips EXIF/GPS), max dimension resize before the vision call; reject decompression bombs.
- **Prompt injection via images**: text inside the image is data. Vision output is a strict Zod schema; free text fields are length-capped and passed in the `image_match` block marked untrusted, like `description_untrusted` today.
- **PII**: customer photos can contain faces, addresses, NID, payment details. Short retention (proposal: 30 days, §8), excluded from analytics, deleted by customer erasure, not sent to the vision provider if the workspace has image-search off. Privacy notice must mention image processing (STATUS lists the privacy-notice update as open).
- **RBAC**: no new customer-facing permission; merchant routes use existing product / social permissions.
- **Platform controls**: new flag `customer_agent_image_search` declared in `src/domains/platform/feature-flag-registry.ts` and checked with `strictFlag`; respects the kill switch and AI budget (each vision call counted as a model call); per-conversation rate limit (proposal: 5 images / 10 min) via `enforceRateLimit`.
- **Truthfulness**: if the vision model is not configured, the system says so (acknowledge + handoff) — never a guessed match. Demo mode is labelled.
- After implementation: run the `security-reviewer` agent and `scripts/smoke-security.mjs` (webhook routes touched).

---

## 6. Testing & Rollout Strategy

### Phases
| Phase | Delivers | Live risk |
|---|---|---|
| **P1 — Capture & honest fallback** | Adapters normalise images on all 4 channels; attachments persisted; media fetched/stored; inbox shows images; image-only turn → acknowledgement + handoff. No vision model. | Low; fixes today's silence |
| **P2 — Understand** | Vision → attributes + OCR/SKU; exact SKU lookup; attribute query into existing `search_products`; shadow mode only (agent-draft). | Medium; shadow only |
| **P3 — Visual match** | Product image index + kNN + fused scoring + bands; send catalog image back; catalog indexing jobs and badges. | Medium; shadow first, then per-tenant autonomous |
| **P4 — Gate & launch** | Image eval set in the offline eval gate; precision threshold enforced in CI before a prompt/model/threshold change ships; per-tenant enable. | — |

### Tests
- Adapter unit cases per channel: image only, image + caption, multiple images, Telegram photo sizes, unsupported types (`tests/social-*-tests.ts`).
- Ingest: attachments persisted; duplicate webhook doesn't duplicate attachments; tenant A can't read tenant B's attachment (negative test).
- Runtime: image-only turn with flag off → handoff; flag on → candidates block present; amounts guard still rejects an amount that only appeared in the image.
- Media: SSRF (private IP, redirect, non-allow-listed host), oversized, wrong MIME, EXIF stripped.
- Erasure: stored object and attachment rows removed.
- Read-only: no GET writes (existing `phase2-readonly-tests.ts` covers new routes).
- `npm run test:pg` after the record shape change.
- **Eval set** (`src/domains/ai/eval`): per demo tenant — exact catalog photo, same product other angle/lighting, customer-taken photo, screenshot of own post with code, screenshot with price, similar-but-not-ours, different colour of an existing product, payment screenshot, selfie, image containing injection text. Metric: precision at HIGH, correct band, no fabricated amount.

### Rollback
- Flag `customer_agent_image_search` off → P1 fallback behaviour (acknowledge + handoff); nothing else changes.
- Vector index is derived data: can be dropped and rebuilt from catalog images.
- Stored media expire by retention; no schema rollback needed for JSONB fields.

---

## 7. Cost & Performance Notes
- One vision call per image (dedupe by `sha256` within a conversation); images resized before upload to the model.
- Image embeddings for catalog computed once per image change; customer image embedded once.
- Turn latency budget: fetch + vision + kNN should add ≤ ~4 s p95 over a text turn; if exceeded, send the acknowledgement first and the answer when ready.

---

## 8. Open Decisions (owner)
1. **Vision model** — hosted (OpenAI-compatible vision endpoint, Gemini, Claude) vs. self-hosted (e.g. a Qwen-VL / Llama-Vision class model behind the existing `LLM_BASE_URL`). Affects cost, Bangla/Banglish OCR quality, data residency.
2. **Image embedding model** — CLIP/SigLIP-class self-hosted vs. a hosted multimodal embedding API. Must be stamped and swappable (like text embeddings).
3. **Object storage** — none exists today. Options: S3-compatible bucket (R2/S3/Backblaze), or Neon/Postgres bytea for P1 only. Recommendation: S3-compatible with per-tenant prefixes and signed URLs.
4. **Retention** for customer images (proposal 30 days; orders keep no customer image).
5. **Telegram** is not in the default `allowed_channel_types`; include it in the pilot or not.
6. Whether P1 ships on its own first (recommended — it fixes a live silent-drop).
