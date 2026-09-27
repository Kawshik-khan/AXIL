---
description: Pre-flight quality and security gates before tagging a release
---

# Release & Deployment Workflow

Follow this pre-flight and deployment checklist before tagging and releasing any version of CommerceOS:

```
[ 1. Pre-Flight Quality Gates ]
         │
         ├── TypeScript Check (`npm run type-check`)
         ├── Linter Pass (`npm run lint`)
         ├── Unit & Integration Tests Pass (`npm test`)
         └── Agent Eval Passes (`node tests/ts-runner.cjs ./tests/ai-tests.ts`)
         │
         ▼
[ 2. Security & Tenant Audit ]
         │
         ├── Zero Committed Secrets Check
         ├── Tenant Isolation Query Audit
         └── Webhook Signature Verification Check
         │
         ▼
[ 3. Build & Container Packaging ]
         │
         ├── Multi-stage Docker Build Verification
         └── Static Asset & Next.js Bundle Optimization
         │
         ▼
[ 4. Staged Migration & Rolling Deployment ]
         │
         ├── Execute Database Migrations
         ├── Health Endpoint Verification (`/health/ready`)
         └── Shift Traffic to New Container Replicas
         │
         ▼
[ 5. Post-Release Verification & Telemetry Monitoring ]
         │
         ├── Verify Dashboard Bento Rendering & Floating Dock
         ├── Monitor P95 Latency & Error Rates in Observability
         └── Update `CHANGELOG.md` with Release Tag
```
> STATUS: TARGET for stages 3–5 — no Dockerfile, CI, or deployment pipeline exists yet. Until then, a "release" is: stages 1–2 green, `npm run build` succeeds, and `STATUS.md` has no open CRITICAL findings.

If post-release monitoring detects elevated 5xx errors or queue backlogs, initiate immediate rollback to the previous container image.
