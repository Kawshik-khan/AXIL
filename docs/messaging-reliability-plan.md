# Messaging reliability: no customer message goes unanswered silently

**Status:** MR0–MR2 built on `codex/AIAgentSkills` (c64f283, 1f10449, MR2), not deployed; MR3–MR5 planned · **Date:** 2026-10-26 · **Owner:** Kawshik ·
**Evidence:** a live Telegram auto-reply test on Render `AXIL` (logs 00:30–01:31 UTC, `agent_jobs` rows on Neon `CommercesOS`)
and a read of the webhook route, ingress, `customer-agent/{jobs,worker,runtime}.ts`, `outbound-message.service.ts` and HITL.
Related: `docs/telegram-bot-messaging-plan.md` (T0–T5, §9), ADR-112 (customer agent jobs), ADR-109 (store unit of work).

Contents: 1 What broke · 2 Goal and invariant · 3 Design decisions · 4 Phases MR0–MR5 · 5 Cross-cutting · 6 Schedule · 7 Risks · 8 What I need from you.

---

## 1. What broke in the live test (2026-10-26)

| # | Symptom | Root cause | Code |
|---|---|---|---|
| B1 | Telegram got 500 on every update, retried for minutes | Telegram's webhook still pointed at a connector id from the pre-cutover DB; nothing checks registration against the DB. The route also let `NotFoundError` escape (500, not 404) | `connectors/[id]/webhook/route.ts`, `connectors/service.ts` `set-webhook` |
| B2 | The bot's own reply refused as `STAFF_REPLIED` | A low-confidence HITL escalation pauses the chat inside the turn, but the turn returned `handoff: false`, so outbound refused it as superseded | `runtime.ts` `finish()`, `outbound-message.service.ts:68-76` |
| B3 | Messages that arrived while paused were never answered, even after resume | `enqueueCustomerTurn` returns early on `automation_paused`; resume does not re-queue | `jobs.ts:68`, `conversations/[id]/route.ts` |
| B4 | "Resume" seemed missing | The paused banner renders at the top of the message stream and scrolls away | `ConversationThread.tsx:358` |
| B5 | Couldn't tell from logs why a turn ended | Access log keeps 3 path segments; `kickWorker`'s pass discards its result; `finish()` overwrites the single job row per conversation; non-DONE outcomes aren't logged | `store-unit.ts:108`, `jobs.ts:33-35`, `worker.ts:72-93` |
| B6 | Escalations on ordinary product questions | `ConfidenceEngine` deducts 35 for a guard-stripped amount and 30 for a tool error, each enough to drop under 75, contradicting the comment that guard rewrites must not pause the chat | `runtime.ts:324-335`, `safety/confidence-engine.ts` |
| B7 | 6–36 s from message to reply | In-process `setInterval` worker on one free Render instance that sleeps | `worker.ts:334`, `render.yaml:322` |

The common cause: chat ownership is one boolean (`automation_paused`) written by five paths (staff send, `handoff_to_human`, HITL
escalation, inbox PATCH, injection/budget guards), and nothing measures whether a customer message got an answer.

## 2. Goal and invariant

**Invariant I1 (the SLO):** within `N` minutes (default 5) of an inbound customer message, exactly one of these is true:
a bot reply was delivered, a named person owns the chat, or the inbox shows the message as *awaiting owner*.
A message in none of those states is a **silent drop**; target silent-drop rate 0, alert on any.

Secondary: p95 inbound→reply ≤ 10 s on a paid instance; every turn ends in a logged terminal outcome; a broken webhook is
detected within 10 minutes.

Non-goals: new channels, a new LLM provider, rewriting the agent prompt.

## 3. Design decisions

- **D1. Ownership is a state machine, not a boolean.** `conversation.control = { state, owner_user_id?, reason, version, changed_by, changed_at }`
  with states `BOT_ACTIVE`, `ESCALATED` (bot may send one acknowledgement), `HUMAN_ACTIVE`, `PAUSED_BY_POLICY`.
  `automation_paused` and `mode` become derived, read-only (kept for the UI and old readers until MR4 ends).
- **D2. A turn holds a lease.** A claimed turn records `control.version` at start. It may send iff the version is unchanged,
  or every change since was made by this turn (`changed_by = turn:<id>`). This replaces `agentHandedOff`, `agentTurnStartedAt`
  and the `staffReplied` scan with one rule, and closes B2 for every escalation path, not only the ones patched in MR0.
- **D3. Turns are append-only.** New collection `agent_turns` (one row per turn: input message ids, outcome enum, reason,
  phase timings, cost, trace id). `agent_jobs` stays as the per-conversation scheduler only.
- **D4. Ingress acknowledges fast and reconciles.** The webhook verifies, stores idempotently and returns 2xx/4xx; a
  reconciler compares each channel's registered webhook with the expected URL.
- **D5. Escalation decides an action, not just a flag.** `SEND_AND_HANDOFF`, `HOLD_FOR_REVIEW` (holding message to the customer,
  draft to staff) or `BLOCK` (attack: canned reply). The customer always hears something unless the chat was already human-owned.
- **D6. Durable queue before more features.** Postgres queue (`FOR UPDATE SKIP LOCKED`) in a separate worker service; the
  in-process timer stays as a fallback for single-server dev.

## 4. Phases

Each phase ships on its own branch, behind a flag where it changes behaviour, and ends with `npm run type-check`, `npm test`,
`npm run test:pg` (store shape changes) and a live Telegram check on Render.

### MR0. Stop the bleeding (commit c64f283)
- Webhook route returns `apiError` (404 unknown connector, 401 bad secret) instead of an uncaught 500. `tests/social-tests.ts`.
- A turn's own HITL escalation counts as its handoff (`escalate()` helper in `runtime.ts`): its reply goes out, the chat stays
  paused; a chat already paused by staff stays refused; one ticket per turn (was two on injection/budget).
  Three regression tests in `tests/stage2-runtime-tests.ts`.
- **Follow-up (closed):** unknown, disabled and unconnected connectors all answer the same 404 before the secret check
  (security review LOW; was MR3.3), and an escalated turn's run records `HUMAN_HANDOFF`.

### MR1. See it (≈1 day) — FX-100
1. **Route template in the access log.** `logRequest` logs `route: "/api/v1/connectors/[id]/webhook"` (the matched App Router
   pattern, passed from `withStore`) next to today's 3-segment `path`. No ids in logs. File: `src/lib/store-unit.ts`.
2. **Every pass and outcome is logged.** `kickWorker`'s pass logs like the interval pass; `finish()` logs
   `customer_agent.turn_finished {conversation_id, status, outcome, attempt, ms}` for every terminal outcome. Files: `jobs.ts`, `worker.ts`.
3. **Turn history** (D3): `customer_agent.turn_finished {status, outcome, attempt, ms}` from the worker's `finish()` for
   every terminal outcome, and `customer_agent.not_queued {reason}` when ingress skips a paused chat. *Changed while
   building:* the `agent_turns` collection moves to MR5's `queue_items` (the queue keeps the history). A new hydrated
   collection that grows with every turn would sit in memory on the free instance, and `agent_runs` already records
   every turn that reached the model.
4. **Silent-drop detector:** the `monitoring` job (every 5 min) reads each active workspace's conversations and counts chats
   whose last customer message is 5 min–24 h old with no later outbound: paused chats as `awaiting_human`, chats on an
   autonomous, allowed channel as `silent`. Any silent drop logs `messaging.silent_drop` and turns `healthy` false.
   File: `src/domains/ai/customer-agent/silent-drops.ts`.
- **Tests:** a suite asserting each terminal outcome writes one `agent_turns` row and one log event; silent-drop counter on a seeded chat.
- **Acceptance:** for any Telegram message on Render, the logs alone tell webhook status, job outcome and send status.
- **Rollback:** additive; revert the commit.

### MR2. Don't drop messages (≈1–2 days) — FX-101
1. **Awaiting-owner marker.** When ingress skips `enqueueCustomerTurn` because the chat is paused, set
   `conversation.awaiting_since` (first unanswered inbound) and increment `awaiting_count`; cleared by any outbound.
2. **Catch-up on resume.** `setAutomationPaused(false)` enqueues a turn when the last customer message is newer than the last
   outbound and within 24 h (Telegram/Meta reply windows respected by `ChannelPolicyService`).
3. **UI:** the paused banner is sticky above the stream (B4) and shows "N messages waiting"; the inbox list shows a badge.
   Files: `ConversationThread.tsx`, `SocialInbox`, CSS module (tokens only).
4. **Guard rewrites don't escalate (B6):** `isCatalogGrounded` is true when the amount guard already removed the ungrounded
   figure; tool errors escalate only when the turn has no usable reply. Tune with `npm run test:eval` before merging.
- *Built 2026-10-26:* `awaiting_since`/`awaiting_count` on the conversation (set in `enqueueCustomerTurn`'s paused
  branch, cleared by a staff send and by resume); `ConversationService.catchUpAfterResume`; banner moved to CSS module classes
  (`pausedBanner`, tokens) with `position: sticky`; `awaitingBadge` in `UnifiedInbox`; `runtime.ts` passes
  `isCatalogGrounded: true` and counts tool errors only for a turn that didn't complete.
- **Tests:** pause → inbound → resume → exactly one turn, one reply; a stripped amount no longer pauses the chat; eval gate green.
- **Acceptance:** live test of today's sequence (message during pause, then resume) gets a reply.

### MR3. Ingress you can trust (≈2 days) — FX-102
1. **Webhook reconciler job** (`connection-health` job already exists): for every Telegram channel call `getWebhookInfo`; on
   URL mismatch re-run `set-webhook`; on `last_error_message` or `pending_update_count > 50` raise an incident and mark the
   channel `DEGRADED` in the connector page.
2. **Lifecycle hooks:** connector delete/disconnect calls `deleteWebhook` (already best-effort; make it reported);
   a `scripts/reregister-webhooks.mjs` for DB cutovers, added to `docs/render-runbook.md`.
3. ~~Uniform pre-auth response~~: done in MR0's follow-up.
4. **Canary:** an hourly job posts a signed synthetic update to a dedicated canary channel's webhook and asserts a turn reaches a
   terminal outcome (shadow mode on that channel, so nothing is sent).
- *Built 2026-10-26:* `src/domains/connectors/telegram-webhook-reconciler.ts` (job `webhook-reconcile`, 10 min) and
  `webhook-canary.ts` (job `webhook-canary`, hourly). *Changed while building:* a mismatch is re-registered only when
  Telegram points at this app under another connector id (the live incident); an unset webhook or a bot routed elsewhere
  (n8n, polling) is reported, never taken over (security review MEDIUM: having registered it once isn't consent to take
  it back). System re-registrations are audited with `reason: stale_connector_id`. The re-register script became "run the job once" in the runbook.
  `set-webhook` moved into `ConnectorService.registerTelegramWebhook` (shared by the action and the reconciler).
- **Tests:** reconciler with a mocked Telegram (mismatch → re-register; error → incident); canary happy path and failure.
- **Acceptance:** deleting and recreating a connector, or a DB cutover, heals within one reconciler interval with no manual step.

### MR4. Ownership state machine (≈4–5 days, ADR-121 via `/architecture-change`) — FX-103
1. `ConversationControlService` is the only writer of `control` (like `OrderLifecycleService` for orders); a transition table
   with allowed `from → to`, actor and reason; version bump on every change; audit row per transition.
2. Migrate writers: staff send, `handoff_to_human`, HITL `createEscalation`/`resolveEscalation`, inbox PATCH, injection/budget
   guards, outside-hours handoff. Each passes `changed_by`.
3. Lease rule (D2) in `OutboundMessageService` for `asAgent` sends; remove `agentHandedOff`/`agentTurnStartedAt` and the
   50-message `staffReplied` scan.
4. Escalation actions (D5) in `runtime.ts`; `HOLD_FOR_REVIEW` writes the draft to the HITL ticket and sends the holding message.
5. Backfill: `control` from `automation_paused`/`mode` (dry run on PGlite, then `--apply` with your go-ahead).
6. Flag `conversation_control_v2`; old fields stay derived for one release, then removed.
- **Tests:** property test over random sequences of {inbound, staff send, staff pause, resume, escalation, handoff tool, turn
  start/end} asserting I1 and "bot never sends into a human-owned chat"; existing Stage 2 tests unchanged in meaning.
- **Rollback:** flag off returns to the boolean path; `control` is additive.

### MR5. Durable queue and worker service (≈3 days, needs a paid Render instance) — FX-104
1. `queue_items` table (migration `009_queue.sql`): `kind`, `dedupe_key`, `run_after`, `attempts`, `locked_until`; claim with
   `FOR UPDATE SKIP LOCKED`. Kinds: `agent_turn`, `outbound_send`, `comment_dispatch`.
2. Render background worker service running `scripts/worker.mjs`; the web service only enqueues. Webhook ingress enqueues in
   the same unit as the message.
3. Outbound outbox: sends retried with backoff by the worker, dead-lettered after `MAX_RETRIES`, delivery receipts update status.
4. In-process timer kept behind `CUSTOMER_AGENT_WORKER=inline` for dev and tests.
- **Acceptance:** p95 inbound→reply ≤ 10 s over 50 live messages; killing the worker mid-turn loses nothing (re-claimed after lease).
- **Rollback:** switch back to `inline`.

## 5. Cross-cutting

- **Security:** run `security-reviewer` after MR0, MR3, MR4 (webhook, ownership, outbound). No tenant from request; ids out of
  logs; canary channel isolated to a platform-owned tenant.
- **Truthfulness:** a turn that didn't send says so (`NOT_SENT` / outcome), never `SENT`; the reconciler marks `DEGRADED`, not `CONNECTED`.
- **Docs:** `.agent/STATUS.md` per phase; ADR-121 for MR4; `docs/render-runbook.md` for the reconciler, re-register script and worker.
- **Dashboards (super-admin):** outcome mix, silent drops, p50/p95 latency, escalation rate, webhook health per channel.

## 6. Schedule (one engineer)

| Week | Work |
|---|---|
| 1 | MR0 commit + MR1 + MR2 |
| 2 | MR3; ADR-121 written and reviewed |
| 3 | MR4 behind the flag, shadow on one workspace |
| 4 | MR4 flag on; MR5 once the instance is upgraded |

## 7. Risks

- **Catch-up replies to stale messages** (MR2): bounded by the 24 h window and one turn per resume; staff can resolve instead.
- **Fewer escalations hide real problems** (MR2.4): gate on the eval set; keep hostile sentiment and injection escalating.
- **State machine migration** (MR4): many writers; the property test and the flag are the safety net.
- **Free plan** limits MR5 and the latency target; the canary also keeps the instance awake, which costs free-plan hours.

## 8. What I need from you

1. ~~Go-ahead to commit MR0~~: done (only the MR files were staged; unrelated changes on the branch stay uncommitted).
2. Silent-drop window `N` (default 5 min) and the catch-up window (default 24 h).
3. A platform-owned tenant and a second Telegram bot for the canary (MR3.4).
4. Render plan upgrade decision for MR5.
5. Approval before any `--apply` backfill or migration against Neon.
