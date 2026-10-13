# AI Agent and Workflow Remediation Plan

**Status:** Approved for implementation under ADR-111; implementation is in progress. See `.agent/STATUS.md` for verified capability state.
**Date:** 2026-10-03
**Scope:** Address the AI audit findings and replace the current synchronous, template-driven workflow execution with a durable, bounded, observable workflow system.

## 1. Goal and current baseline

The goal is to make the AI and workflow paths safe to operate, testable against their real execution contracts, and recoverable after process or provider failure. The LLM remains a probabilistic planner/synthesizer. Commerce services, policy checks, and Postgres remain authoritative. No agent receives direct storage or arbitrary HTTP access.

Current code already has a bounded LLM/tool loop in `src/domains/ai/agents/base-agent.ts`, a model router, tenant-scoped tool gateway, knowledge retrieval, persistent summaries, workflow/task records, approval records, and a demo-mode evaluation gate. The customer agent runtime and the separate workflow engine are distinct systems. The latter currently uses keyword-selected fixed plans (`supervisor.agent.ts`), executes inside the request path, and initializes budget/checkpoint data without enforcing all of it during execution. The implementation phases below preserve the usable pieces while closing those gaps.

Repository status is the source of truth for operational state. Before implementation, reconcile stale AI guidance (`.agent/rules/agents.md`, `.agent/skills/rag-engineering/SKILL.md`) with the current provider and embedding implementation and the latest `.agent/STATUS.md`.

## 2. Non-goals and guardrails

- Do not add an agent framework, vector database, broker, or other heavy dependency without a demonstrated need. The first workflow version uses the existing Postgres system of record and a small worker process.
- Do not let LLMs read/write the store directly, decide permissions, set tenant IDs, or become authoritative for commerce facts.
- Do not automatically enable high-risk actions. Approval remains a deterministic gate, bound to an exact action payload and state snapshot.
- Do not conflate customer-facing `AgentRuntime` tool calls with long-running `WorkflowEngine` tasks. Share typed policy and observability primitives where useful; preserve separate orchestration contracts.
- Do not expose a new workflow capability to tenants until authorization, tenant isolation, durable execution, duplicate-delivery handling, and kill-switch behavior pass negative tests.
- Keep simulated provider behavior labeled as demo/simulated. Do not use demo-model results as evidence of live model quality.

## 3. Target workflow architecture

```text
Authenticated API / internal event
  → strict Zod command + session-derived tenant scope
  → Workflow application service
      → deterministic policy/entitlement/budget preflight
      → atomic workflow + tasks + outbox/job commit
  → Postgres-backed worker poller (claim with lease / SKIP LOCKED)
      → typed task handler allowlist
      → domain service / read-only agent identity
      → deterministic postcondition verification
      → atomic task result + event + next runnable work
  → approval wait when required (immutable action digest + expiry)
  → resume only after authorized approval and state revalidation
  → workflow terminal state + audit trail + metrics
```

The worker is at-least-once. Handlers must be idempotent or use a persisted idempotency key and action receipt. A lease expiry makes abandoned work claimable again; a fencing token prevents an old worker from committing after losing its lease. External effects must use provider idempotency when available. If the external outcome is uncertain and the provider offers no safe idempotency mechanism, mark the task `OUTCOME_UNKNOWN`, stop automatic retries, and require reconciliation. Do not claim exactly-once delivery.

### Workflow lifecycle

Use explicit states with checked transitions: `DRAFT → QUEUED → RUNNING → WAITING_APPROVAL / WAITING_HUMAN / RETRY_WAIT → RUNNING → COMPLETED / FAILED / CANCELLED / EXPIRED / OUTCOME_UNKNOWN`. Store the transition actor, reason, timestamp, correlation ID, and version. Terminal states cannot resume except through an explicit new workflow or a narrowly defined retry operation.

Each task has a type, validated input schema, tenant and workflow IDs assigned by trusted code, allowed handler, deadline, attempt limit, idempotency key, status, lease owner/token/expiry, result reference, sanitized error class, and next-attempt time. Do not persist arbitrary LLM output as executable task input. Plans are immutable once execution begins; replanning creates a new plan version after recording why and which observation authorized it.

### Planning model

Start with deterministic templates for the supported commerce workflows and name that mode accurately. Templates produce a typed DAG and remain the default for sensitive operations. Add optional LLM-assisted planning only after the durable executor and policy contract exist. The model may propose task types and arguments from an allowlisted schema; deterministic code validates the DAG, dependencies, entity scope, per-step permissions, risk, budget, and maximum size. A model proposal cannot create a new tool, handler, tenant, permission, or approval result. Replanning is bounded and requires an explicit workflow policy; it is never an unbounded autonomous loop.

## 4. Execution control and approval contract

Implement `RunBudget` enforcement for every model/tool/task boundary. Fields include maximum wall time, model calls, input/output tokens, tool calls, task count, provider cost estimate, actual reported usage, and retry count. Reserve budget atomically before a call, settle afterward, and refuse or pause before the next call when the cap is exhausted. Global platform limits and tenant policy both apply. A concurrency-safe reservation prevents simultaneous requests from overspending. Usage records distinguish provider-reported values, estimated values, demo values, and unknown values.

Approval records bind to the exact canonical action payload hash, target entity, tenant, actor/requester, policy version, relevant entity versions/state snapshot, expiry, and approver. On approval, re-read authoritative state and re-evaluate permission, kill switch, entitlements, risk and budget before execution. Any payload or protected-state change invalidates the approval. Enforce separation of requester and approver where policy requires it. Never rely on the LLM's confidence or Jev score as authorization.

## 5. Prompt, context, memory, and retrieval changes

### Trust separation

- Keep policy and role instructions in the system message.
- Put user, retrieved, memory, and external tool content in explicitly untrusted data messages/typed sections. Escape delimiters and never interpolate untrusted values into instruction text.
- Preserve source IDs, tenant, document version, retrieval query, channel, timestamp, trust class, and transformation lineage for each context item.
- Tool outputs are observations, not instructions. Tool execution still passes schemas, agent allowlists, RBAC, policy and domain validation.
- Apply deterministic output contracts to structured actions. Text checks for leaked secret patterns remain defense-in-depth only.

### Context budget and PII

Add a context assembly result containing selected items, omitted items/reasons, token estimates, truncation decisions, and a prompt/context hash. Budget by tokens before provider calls. Order context by task need and trust: policy, required commerce facts from tools, relevant source-backed retrieval, summarized history, then current request. Redact PII before external model calls according to tenant policy and provider configuration; record redaction mode without storing raw secrets in traces.

### Memory lifecycle

Keep working memory (current run) separate from persistent conversation summary and structured customer preferences. Summaries carry source message range, model/provider/prompt version, generated time, and confidence/status. On summarization failure, persist an explicit unavailable/stale state instead of a fabricated summary. Treat memory as untrusted, non-authoritative context. Add tenant-scoped read/update/delete, retention/expiry, correction, and audit behavior. Do not add automatic customer-memory writes until the write policy and source validation are defined.

### RAG reliability

Report dense, lexical, and Qdrant channel outcomes independently, including timeout/error/empty-result reasons. Continue with BM25 when dense search is unavailable but mark the result as degraded. Correct terminology: current reranking is a deterministic lexical/RRF formula, not a learned cross-encoder. Confidence labels are heuristic until calibrated against labeled query-document-answer data. Add embedding model/dimension identity to indexed documents; reject dimension/model mismatches and reindex explicitly. Ingestion failure must not leave mixed-version chunks active.

## 6. Evaluation and observability

Separate three gates:

1. **Deterministic policy/integration tests:** tool schema rejection, RBAC, tenant isolation, approval binding, state transitions, idempotency, budgets, retries, kill switches and store atomicity. These run without external providers.
2. **Offline AI quality evaluation:** fixed provider/model snapshot where available; versioned datasets; intent, correct tool name/arguments, grounded claim/citation checks, injection resistance, language quality and refusal/handoff criteria. Keep demo-mode scores in a separate report labeled `DEMO_POLICY_REGRESSION`.
3. **Live-provider smoke/evaluation:** opt-in credentials and explicit invocation; no production data; report model/provider/version, prompt hash, latency, token usage and redacted failures. Never make normal CI dependent on provider availability.

Correct metric definitions: tool-selection accuracy must compare actual selected tools against expected tools, not reuse intent accuracy. Grounding must verify each factual claim against authoritative tool output or cited retrieved content; response non-emptiness is not grounding. Report denominators, skipped cases, confidence intervals where appropriate, per-category results, and dataset version. Threshold changes require reviewed evidence.

Emit structured run/workflow/task spans with correlation IDs, tenant-safe identifiers, model/provider and prompt/context hashes, retrieval channel health, tool name and outcome, policy decisions, approval IDs, retry/lease transitions, budget reservation/settlement, and sanitized errors. Avoid raw prompt, user PII, credential, and full tool-payload logging by default. Add dashboards/alerts for queue age, lease expiry, repeated failures, unknown external outcomes, budget rejection, model errors, retrieval degradation, approval age and kill-switch activation.

## 7. Phased implementation plan

### Phase 0 — Baseline and documentation correction

**Objective:** Establish a truthful baseline and agree on architectural boundaries before code changes.

**Work:**
- Reconcile `.agent/STATUS.md`, `.agent/rules/agents.md`, `.agent/rules/rag.md`, `.agent/skills/rag-engineering/SKILL.md`, `.agent/README.md`, and relevant roadmap entries with current source and tests.
- Build an inventory of AI API routes, all registered tools and concrete tool implementations, workflow routes, scheduled/event triggers, and every call site of policy/budget/approval methods.
- Record existing type-check and relevant test-suite baselines. Do not run live DB/provider operations without explicit approval.
- Draft an ADR for durable workflow execution and any schema/API changes. Review alternatives: synchronous execution, Postgres polling/outbox, external broker. Prefer Postgres polling first unless measured throughput requires a broker.

**Acceptance:** Source-of-truth status no longer claims stale mock-only/fake embedding behavior; every capability is marked LIVE/PARTIAL/SIMULATED/TARGET with evidence; ADR states state machine, delivery semantics, migration/rollback and operational model.

### Phase 1 — Immediate agent safety and cost controls

**Objective:** Close exploitable context-trust and unbounded-cost gaps before enabling new autonomy.

**Affected areas:** `src/domains/ai/context/`, `agents/base-agent.ts`, `runtime/agent-runtime.ts`, `policy/agent-policy.service.ts`, `providers/model-router.ts`, AI run/usage types and store methods; `tests/ai-tests.ts`, `tests/security-regression-tests.ts`, `tests/agentic-rag-tests.ts`.

**Tasks:**
- Add a typed `UntrustedContextItem` contract and separate data messages from policy/system instructions.
- Validate agent-provided tool names and arguments again at the gateway; reject malformed provider tool-call JSON instead of converting it to `{}` and continuing.
- Wire tenant/global kill switches, AI entitlement, daily budget reservation, per-run call/token/time/tool caps into the earliest safe execution boundary.
- Add atomic usage reservation/settlement and label provider-reported vs estimated vs demo usage. Remove fixed synthetic token/cost values from handoff telemetry.
- Ensure cancellation/deadline propagates to the provider transport; account for total run time, not only checks between loop iterations.
- Convert fallback/error states to explicit typed results; do not silently convert security-relevant errors into normal empty context.

**Tests:** Direct, role, retrieved-content, memory, tool-result and multi-hop injection attempts; tool-call schema fuzz/invalid JSON; tenant A/B context/tool isolation; budget boundary and concurrent reservation; timeout/cancellation; kill switch during a run; no secret or raw PII in traces.

**Acceptance:** No untrusted context is sent in the trusted policy message; over-budget runs make no subsequent provider/tool call; concurrent runs cannot exceed reserved caps; all rejected actions are auditable and non-mutating; existing tool behavior remains compatible.

### Phase 2 — Correct prompt/context/memory provenance

**Objective:** Make model inputs reproducible, bounded and governable.

**Affected areas:** `context/context-builder.ts`, `context/pii-redaction.service.ts`, `memory/memory.service.ts`, `prompts/prompt-registry.ts`, AI run/summary/memory records, `src/infrastructure/db/` and tests.

**Tasks:**
- Resolve prompt template/version once at run start; save content hash, prompt version, model/provider configuration ID and context hash with run metadata.
- Add token-budget estimation, priority selection, deterministic truncation and a persisted/debuggable selection manifest.
- Persist source message range and generation metadata for conversation summaries; distinguish fresh/stale/unavailable; remove fallback summaries that imply facts not summarized.
- Define memory ownership, retention, correction, deletion, and tenant-scoped access. Add PII minimization and tests for deletion across derived summaries.
- Preserve tool and retrieval provenance without storing sensitive raw payloads unnecessarily.

**Tests:** prompt hash stability and version drift; oversized conversation and retrieval inputs; summary failure/unavailable state; tenant-scoped memory read/delete; PII redaction; retrieved and memory instructions remain data.

**Acceptance:** Any completed run can identify the exact prompt template version/hash and model config; context is within configured token budget; summary lifecycle is explicit; provenance and deletion behavior are covered by tests.

### Phase 3 — RAG truthfulness and retrieval quality

**Objective:** Make degraded retrieval visible and confidence/citation claims evidence-based.

**Affected areas:** `rag/embedding.service.ts`, `hybrid-search.service.ts`, `reranker.service.ts`, `agentic-rag.controller.ts`, `knowledge.service.ts`, Qdrant adapter, knowledge chunk schema and `tests/agentic-rag-tests.ts`, `tests/qdrant-rag-tests.ts`.

**Tasks:**
- Add per-channel result status and error reason; make BM25 fallback explicit in result and run trace.
- Rename the current cross-encoder to heuristic reranker in code/docs/UI metadata.
- Persist embedding model ID and dimensions per document/index; validate dimensions on upsert/query; keep failed or partial reindex out of the active index until atomic activation.
- Add source version and exact chunk/parent references to citations and context manifest.
- Create a labeled evaluation set for Bangla/Banglish/English queries, paraphrases, conflicting documents, no-answer cases, poisoning, tenant boundaries and stale versions; calibrate thresholds from results.
- Ensure the final answer can distinguish `no evidence`, `retrieval degraded`, and `retrieved evidence` rather than treating each as normal success.

**Tests:** tenant A/B isolation at vector and BM25 layers; provider outage; Qdrant outage; mismatched embedding dimensions; empty and weak retrieval; stale index/reindex activation; poisoned document never authorizes tools; citation version/source correctness.

**Acceptance:** Retrieval traces show channels and fallbacks; no heuristic score is described as model confidence; stale or partial indices cannot silently replace active content; answer citations resolve to tenant-owned source versions.

### Phase 4 — Durable workflow foundation

**Objective:** Move long-running orchestration out of synchronous API requests and make recovery semantics explicit.

**Architecture changes:** Reuse the existing Postgres-backed store and ADR-110 outbox/claim-worker principles for the first version. Add AI workflow job records through the existing store API unless measured concurrency or query performance requires dedicated tables. Avoid introducing Redis or a broker in the first version. Worker claims use bounded polling, lease expiry and monotonically increasing fencing/version tokens. API mutation and job enqueue commit atomically.

**Affected areas:** `src/domains/ai/orchestration/engine/`, task/workflow types, `src/infrastructure/store/` migrations and store mapping, `src/app/api/v1/ai/workflows/**`, worker entrypoint/instrumentation, `package.json`, operational docs, orchestration and Postgres suites.

**Tasks:**
- Define and enforce workflow/task state-transition tables, versions and legal terminal states.
- Add durable job/outbox schema, unique idempotency constraint, scheduled retry time, lease owner/expiry/fence, attempt count, correlation ID, and sanitized error class.
- Implement atomic create workflow + task set + enqueue; implement worker claim/heartbeat/complete/fail transactions.
- Add graceful shutdown, lease release or expiry, bounded concurrency, per-tenant fairness, stale lease recovery, queue age limits and poison-task handling.
- Return `202 Accepted` plus workflow/run resource for queued work; preserve existing API shape only if it can accurately represent async status, otherwise version the contract.
- Add operational commands/runbook for worker health, pause/resume, draining, dead-letter inspection, and safe replay.

**Tests:** two worker instances competing; crash before/after claim; expired lease and stale fencing token; duplicate enqueue; atomic enqueue rollback; per-tenant fairness; shutdown/drain; worker unavailable; outbox replay; Postgres reload preserving job/task state.

**Acceptance:** A committed API acknowledgement always has durable queued work; duplicate requests do not duplicate logical work; crashed tasks recover without stale workers committing; no external side effect is retried blindly after uncertain outcome; JSON backend is either explicitly unsupported for workers or has documented single-process semantics.

### Phase 5 — Workflow planner and typed task handlers

**Objective:** Replace misleading dynamic-planning claims with safe, typed and testable planning.

**Affected areas:** `orchestration/agents/supervisor.agent.ts`, `planning/task-planner.ts`, `planning/plan-validator.ts`, `engine/task-executor.ts`, `agent-registry.ts`, domain services, workflow API schemas and orchestration tests.

**Tasks:**
- Extract current recognized plans into named versioned workflow templates with schemas, triggers, declared task types, dependencies, permissions, risk and acceptance conditions.
- Replace string `includes` routing with explicit template selection rules and deterministic precedence. Unknown/ambiguous objectives return a clarification/manual-review result.
- Build a typed handler registry keyed by `task_type`; each handler validates input, checks permission and tenant scope, calls domain service, and returns a typed observation/postcondition.
- Remove arbitrary task-to-agent/tool dispatch; reject unknown task types and tools. Validate DAG acyclicity, max nodes/depth, dependency ownership, argument bounds and risk classification.
- Add an optional LLM proposal adapter only behind a disabled-by-default feature flag after schema validation and evaluation. Model proposals cannot execute directly or alter policy.
- Define replan policy: allowed triggers, maximum replans, immutable prior plan versions, required observation, budget reservation and approval reset behavior.

**Tests:** template precedence/ambiguity; invalid/cyclic/oversized DAG; unknown task/tool; task arguments with mismatched tenant/entity; LLM malformed plan and injection; replan limit; observed error changes plan only through declared transitions.

**Acceptance:** Every workflow is explainable as a named template or validated plan version; every task maps to one reviewed handler; no raw objective or model text is executable; no silent fallback to an unrelated workflow.

**Implementation update (2026-10-03):** The supervisor now uses five explicit version-1 template selectors instead of broad substring priority. Numeric incidental text (for example, “50”) no longer selects wholesale. Cross-domain matches return an ambiguity clarification; unknown objectives require clarification/manual review. Workflow create accepts an explicit template code, event triggers forward their configured template code, simulation reports the selected `code@version`, and created workflows persist template code/version metadata. The DAG validator rejects unregistered task types, task/agent mismatches, undeclared tools, under-stated risk, duplicate dependencies, oversized names/parameter maps, and tenant/workflow/agent/policy scope keys inside untrusted step parameters. Focused verification: type-check 0 and orchestration 39/39.

**Remaining for full Phase 5 acceptance:** The five template graphs are versioned selectors but are not yet extracted into fully schema-bearing immutable template records with acceptance conditions. The executor now fails closed with 501 for task types without one of its four registered read-only handlers, and simulation separately reports `execution_ready` only when every step has a handler and its required entity inputs are present. There is not a reviewed handler for every declared task type; several previews remain structurally valid but not runnable. Do not interpret `validation.isValid` as proof that the workflow is runnable. Strict per-task argument schemas and permissions, consistency between planner tool names and registered tools, executable template coverage, handler-level tenant/entity validation and explicit replan/version transitions are still required. LLM proposal planning remains disabled/unimplemented.

### Phase 6 — Workflow budgets, retries, idempotency and approvals

**Objective:** Make task execution bounded and safe under concurrency, errors and human delay.

**Affected areas:** workflow/task/approval types and services, task executor, approval routes, relevant domain services, store constraints, operational tests.

**Tasks:**
- Enforce workflow and per-task budgets before scheduling and before each provider/tool/effect call; reserve and settle concurrently.
- Classify failures as retryable, permanent, policy-denied, rate-limited, or outcome-unknown. Use capped exponential backoff with jitter and deadlines; never retry non-idempotent uncertain sends automatically.
- Ensure task idempotency keys are stable across retry and checked at the domain boundary/action receipt, not generated anew on replay.
- Bind approval to canonical payload digest, state version, policy and expiry; revalidate at execution. Record requester/approver separation and reason.
- Add `OUTCOME_UNKNOWN` and manual reconciliation paths for external effects whose result cannot be confirmed.
- Ensure cancel/pause stops future work and cancels in-flight work where safe; record cancellation races explicitly.

**Tests:** parallel budget reservation; retry taxonomy; same idempotency key across replay; duplicate side-effect prevention; approval payload tamper; stale entity version; expired approval; requester self-approval; cancellation race; uncertain provider outcome.

**Acceptance:** Budgets cannot be bypassed by retries or concurrent workers; approval authorizes only the reviewed payload/state; uncertain external effects never produce false success or duplicate sends; retry and cancel behavior is documented and tested.

**Implementation update (2026-10-03):** Task failures now carry `RETRYABLE`, `PERMANENT`, `POLICY_DENIED`, `RATE_LIMITED`, or `OUTCOME_UNKNOWN` classification. Only transient/rate-limited failures retry automatically, using deterministic jitter with capped exponential delay and the original task idempotency key; task attempt limits remain in force. `TaskOutcomeUnknownError` stops automatic replay and holds the workflow in `WAITING`. The workflow engine exposes an operator reconciliation method that records actor/evidence, marks an applied action complete with a receipt, or records that it was not applied before resuming. A successful action receipt is checked before dispatch so a crash after receipt persistence can recover the task result. Verification covers transient retry scheduling, replay suppression for unknown outcomes, and the applied reconciliation path. Provider adapters must explicitly throw `TaskOutcomeUnknownError` when they cannot establish whether a remote effect committed.

**Remaining for full acceptance:** The current workflow handlers are local/read-only; no production provider-backed effect adapter exercises uncertain outcomes. Reconciliation is currently a service method with no operator API/UI or route-level RBAC/audit integration; deployment must not treat it as an available merchant operation until that control plane is built. Cross-process replay races and provider idempotency guarantees remain unverified.

**Approval safety implementation update (2026-10-03):** Approval requests bind a canonical SHA-256 digest of tenant/workflow/task/action/risk/input, autonomy policy revision, and authoritative order state. Approval/rejection decisions are atomic and single-use, require a task still waiting on that exact request, enforce requester/approver separation for user-created workflows, and revalidate expiry, current policy, payload and target state. The executor independently requires an approved, unexpired, still-matching request before running any action that current autonomy policy gates. Agent policy revisions increment on policy and kill-switch changes. Approval decisions are audited without raw action payloads. The decision route accepts strict Zod bodies and requires an explicit rejection reason.

**Remaining for full approval acceptance:** Authoritative snapshot adapters currently support orders only; approvals for unrecognized or unsupported target types fail closed. Step-up authentication/dual-custodian policy configuration and concurrent production-worker stress testing remain unverified.

### Phase 7 — Evaluation, observability, and rollout gates

**Objective:** Make quality and operations measurable before enabling broader use.

The dedicated staged implementation plan for RAG retrieval quality, dataset design, embedding/index integrity, channel diagnostics, reranking, claim-level grounding and rollout is [`rag-quality-implementation-plan.md`](rag-quality-implementation-plan.md). RAG quality acceptance should follow that plan and must not be inferred from the agent workflow benchmark alone.

**Affected areas:** `src/domains/ai/eval/`, `tests/eval-gate.ts`, `tests/evals/thresholds.json`, orchestration telemetry, run/workflow APIs and UI, monitoring/runbooks, `.agent/STATUS.md`.

**Tasks:**
- Correct current evaluation metrics and split demo policy regression from live-model quality evaluation.
- Add versioned test datasets for planning, tools, injection, RAG, memory, context size, policy, recovery and tenant separation.
- Add workflow execution traces and metrics described in §6, plus alerts and retention/redaction policy.
- Add operator views for queue health, waiting approvals, failed/unknown-outcome work and replay eligibility; show whether values are measured, estimated, demo, or unavailable.
- Roll out dark/read-only first, then selected tenant allowlist, then low-risk action classes only after SLO and incident review. Keep high-risk effects approval-gated.
- Update STATUS only after end-to-end evidence against the configured persistence and worker runtime.

**Tests:** metric mutation tests (a broken tool expectation fails tool accuracy); trace redaction; workflow trace completeness; alert thresholds; demo/live labels; golden-set regression; UI empty/error/unauthorized states; feature flag and kill switch behavior.

**Acceptance:** Every production claim maps to a test/manual trace; thresholds and dataset versions are reviewable; operators can stop, inspect, and reconcile work; rollout can be halted without losing queued records.

## 8. Suggested delivery sequence and dependencies

```text
Phase 0 → Phase 1 → Phase 2
                    ↘ Phase 3
Phase 0 → Phase 4 → Phase 5 → Phase 6 → Phase 7
```

Do not begin LLM-generated workflow planning before Phases 1 and 4 are complete. Start worker rollout with one read-only workflow and one worker instance in a non-production environment, then test multi-worker concurrency on an isolated Postgres branch. Add write-capable workflows one at a time after action idempotency and approval binding pass their negative tests.

## 9. Definition of done for implementation

- `.agent/GOVERNANCE.md` invariants remain intact; `tenant_id` is session/worker-scope derived and never trusted from model output.
- Every mutation is authorized at the domain boundary, strict-schema validated, tenant-filtered and transactional.
- Workflow enqueue/claim/lease/transition/retry/approval/cancel semantics are documented and tested on PGlite, including multiple workers and restart/reload.
- No acknowledged workflow enqueue is lost; no stale worker can commit after lease fencing; no duplicate logical action occurs on replay.
- Model prompts/context, retrieval channel outcomes, tool calls and cost measurements are traceable with PII/secrets redacted.
- Evaluation names match actual assertions; relevant suites and `npm run type-check` pass without increasing baseline errors.
- Live provider and external database checks are explicitly separated from default CI and run only under the project’s approval rules.
- `.agent/STATUS.md`, ADRs, API contracts, runbooks, and roadmap describe what is verified versus partial, simulated, or target.

## 10. ADR-111 decisions and implementation status

ADR-111 was approved with the following first-slice decisions: use the existing store/Postgres persistence and polling worker; keep workflow command endpoints asynchronous (`202 Accepted`); keep unknown workflow objectives unsupported rather than inventing a fallback; do not introduce a broker or other heavy dependency. The offline evaluation gates pass against tenant-owned catalog and multilingual policy fixtures.

**Implementation update (2026-10-03):** Strict provider tool-argument parsing, execution-time agent tool allowlists, typed/redacted context manifests, prompt/model provenance, kill-switch checks, per-run token/time bounds, atomic daily/monthly live-model spend holds with in-place settlement, atomic workflow/task/tool budget holds with settlement and expired-hold recovery, task deadlines, cooperative worker cancellation checks, a durable command worker, tenant-interleaved queue selection, monotonic claim fencing, bounded worker drain, and separate offline/live eval commands are present. The model spend hold reserves the configured per-run token cap at the highest configured reasoning-tier completion rate and expires after 15 minutes. Workflow budget allocations partition token, USD cost, tool-call and duration ceilings; a task atomically claims its share before execution, each action records usage before dispatch, and settlement charges consumed usage while releasing the unused hold. Worker recovery settles expired holds and fails unfinished tasks instead of freeing consumed budget. Task timeout and cancellation checks prevent the currently supported local read-only handlers from writing a stale completion or receipt; the worker polls persisted workflow/job state and forwards an abort signal. Focused AI, orchestration, persistence, type-check, and offline eval checks passed in this implementation pass. This closes code slices, not the plan's full acceptance criteria.

**External cancellation implementation update (2026-10-03):** The workflow worker tracks live executions, aborts them on persisted cancel/pause/lease loss and on graceful worker stop, and verifies the claim fence and lease expiry while polling. AbortSignal now propagates through AgentRuntime, simulation/Copilot routes, BaseAgent, ToolRegistry, ModelRouter and OpenAI-compatible provider calls. ModelRouter does not count cancellation as a provider failure or issue a fallback request after cancellation. The guarded outbound HTTP client aborts DNS/connect/send/response work and exposes `OutboundCancelledError.mayHaveReachedPeer`; workflow task dispatch receives the signal for future provider adapters. The local outbound integration test verifies cancellation after a POST may have reached the receiver. Type-check, phase5 integration (29/29) and orchestration (37/37) passed in memory.

**External cancellation limits / remaining acceptance:** Aborting a socket cannot retract a request already accepted by a remote provider. Any non-idempotent remote action must use provider idempotency and preserve OUTCOME_UNKNOWN for reconciliation when commit status cannot be proven; do not report such an action as rolled back. Actual provider-backed workflow effects do not exist in this slice, and cross-process cancellation/fencing races and graceful shutdown on production Postgres remain unverified. Cancellation of an LLM request may still incur provider cost when the peer accepted it; current cancelled runs do not have confirmed final token usage. Also open: actual workflow model token/cost metering; operator reconciliation API/UI; full summary/memory lifecycle and provenance; per-channel RAG status and fallback traces; embedding model/dimension versioning and atomic index activation; broader typed workflow handlers/templates; budget and fencing concurrency under real worker load; worker health, pause/resume/replay/dead-letter controls; monitoring UI/alerts; broader live-model and retrieval-quality datasets. The live gate previously passed once, later scored 86.7% with provider failures, and the latest run stopped during eval-fixture ingestion because the configured embedding provider returned HTTP 429. Do not mark these acceptance items complete based only on focused local checks.

The implementation status and verification limits are maintained in `.agent/STATUS.md`. Do not describe the AI workflow system as production-ready until the remaining acceptance criteria above pass on the configured Postgres deployment and the demo evaluation gate is corrected and green.
