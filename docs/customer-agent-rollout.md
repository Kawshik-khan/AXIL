# Customer agent rollout: shadow → Telegram pilot → WhatsApp → GA

AI fix plan FX-87 (ADR-112, ADR-114). Every step is a per-workspace switch you can undo in seconds. Nothing here needs a
deploy once Stages 0–4 are live.

## Before the shadow week

| Item | Where | Done when |
|---|---|---|
| Migrations 009 and 010 applied | `npm run db:migrate` (pre-deploy) | `_migrations` lists both |
| Staging service live with its own stores | `render.yaml` → `commerceos-staging` | `GET /health/ready` green on staging |
| Agent eval gate on | GitHub: variable `AGENT_EVAL_GATE=on`, `evals` environment with `OLLAMA_EVAL_API_KEY` (and `GEMINI_EVAL_API_KEY` for retrieval), required reviewers on that environment | `Agent evals` workflow green 3 nights running |
| Provider profile | Render: `LLM_*`, `LLM_MAX_CONCURRENCY` = the Ollama plan's limit, `LLM_PRICING_JSON` with cached input | Super-admin → Agent Health shows real cost |
| Staff MFA | Each owner/admin: Settings → Security | `WORKSPACE_STEP_UP_ENFORCED_FROM` set |
| Kill switches rehearsed on staging | see "Rehearsal" below | all three rehearsed and noted |
| WORKFLOW kill switch on for every workspace | super-admin → Kill Switch | until FX-98 ships (audit F31) |
| Privacy notice | the shop's site / chat greeting | names Ollama (LLM) and Google (embeddings) as processors |
| Meta Business verification + WhatsApp templates | Meta Business Manager | start on day 1: 1–2 weeks regardless of code |

## Step 1: shadow week (2–3 workspaces, 1 week)

1. Workspace AI policy: `ai_mode = AI_COPILOT` (the default) and `TELEGRAM` in `allowed_channel_types`.
2. Platform flag `customer_agent_shadow` on, allow-listed to those workspaces.
3. The agent drafts a reply to every customer message; staff answer as usual and see the draft at the bottom of the
   inbox thread, marked "not sent". They rate each draft **usable / not usable**.
4. Watch super-admin → Agent Health → "Shadow → pilot". Go when every check is "yes":
   - at least 20 drafts rated, **≥ 85% usable**;
   - **0 money-claim guard triggers** (order claims, payment claims, invented amounts);
   - **p95 latency ≤ 8 s**.

## Step 2: Telegram pilot, wave 1 (1–2 workspaces, 2 weeks)

1. Workspace settings: `customer_agent_hours = { "start_hour": 10, "end_hour": 22 }` (shop-local). Outside those hours
   the agent hands the chat to the team and tells the customer when someone will answer; no model call is made.
2. Staff on call 10 AM–10 PM for handoffs (the handoff card at the top of the thread shows the reason, what the customer
   said, the open quote and a reply-by time).
3. Workspace AI policy `ai_mode = AI_AUTONOMOUS`; flag `customer_agent_autonomous` on for the workspace; shadow off.
4. Identity: a Telegram chat sees only orders placed in that chat until the customer shares **their own contact** (Telegram
   → attach → Contact → their own number). Then it sees that number's orders, like WhatsApp.
5. Daily: review a sample of pilot chats for wrong actions (orders, prices, other customers' data). Weekly: CSAT.
6. Hold criteria ("Pilot holds" in Agent Health): 0 money-claim guard triggers, handoff queue age p95 ≤ 10 min,
   p95 ≤ 8 s; plus the manual checks (0 wrong actions, CSAT not worse, nightly eval green).

## Step 3: WhatsApp pilot, wave 2 (after FX-50 ships)

Same workspaces and criteria with WhatsApp added to `allowed_channel_types`. WhatsApp numbers are verified by WhatsApp.

## Step 4: GA

Per workspace, opt-in, once the pilot numbers held for 2 weeks. Messenger and Instagram follow when FX-50 adds sending;
the website widget when it can receive replies.

## Rollback (any step, seconds)

| What | How | Effect |
|---|---|---|
| One workspace | flag `customer_agent_autonomous` off for it (remove from the allow-list) | new messages go to the inbox; nothing else changes |
| Everyone | flag off globally | same, platform-wide |
| The model provider | kill switch `PROVIDER/<LLM_PROVIDER_NAME>` | no model calls; customers get the standard "a team member will reply" message and a handoff |
| One channel | kill switch `CHANNEL/<channel id>` | no model call and no send on that channel |
| A workspace | kill switch `TENANT/<workspace id>` | everything for that workspace stops |

No data needs undoing: migrations 009 and 010 only add columns and indexes.

## Rehearsal on staging (before the pilot)

1. With a test workspace on autonomous and a test Telegram bot: send a message, see the reply.
2. Turn on `PROVIDER/<name>`: send a message → the standard reply arrives and the chat shows a handoff card; Agent Health
   shows no new model call. Turn it off.
3. Turn on `CHANNEL/<id>`: send a message → no reply, the job ends `KILL_SWITCH`. Turn it off.
4. Turn the flag off: send a message → no job; the chat sits in the inbox.
5. Note date, who, and the result in this file under "Rehearsals".

## Rehearsals

| Date | Who | Provider switch | Channel switch | Flag off | Notes |
|---|---|---|---|---|---|
| | | | | | |
