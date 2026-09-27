---
trigger: glob
description: n8n as orchestration only, idempotency, sub-workflows, DLQ
globs: n8n/**/*, src/domains/automation/**/*
---

# n8n Integration & Workflow Rules

1. **Orchestration Only (No Backend Replacement)**:
   - n8n must NEVER serve as the primary database or store authoritative business logic.
   - All mutations in CommerceOS must occur via authenticated API endpoints (`/api/v1/*`).

2. **Idempotency Mandate**:
   - Every workflow triggered by a webhook or event must check an idempotency key before performing side-effects.
   - Re-delivering the same event within 24 hours must produce an identical, non-duplicate result.

3. **Sub-Workflow Modularity**:
   - Monolithic workflows exceeding 20 nodes are prohibited.
   - Extract common patterns (e.g. sending WhatsApp notifications, looking up customer profile, verifying courier credentials) into reusable sub-workflows.

4. **Error Handling & Dead-Letter Queues**:
   - Every workflow must implement an Error Trigger that logs failures, captures execution input, and pushes failed jobs to the Dead-Letter Queue.
