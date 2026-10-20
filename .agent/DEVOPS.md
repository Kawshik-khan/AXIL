# CommerceOS DevOps & Deployment Guide

> **Status:** TARGET. No Dockerfile or Kubernetes exists. Env vars: see the real `.env.example` (Neon, Pinecone, Upstash).

> **Current constraint — exactly one replica (FIX_IMPLEMENTATION_PLAN FX-24, decision D3).** Until the Postgres cutover (FX-45), data lives in one JSON file, `.data/commerceos.json`, owned by one process:
> - At start the app takes `.data/commerceos.lock`. A second process (another `next dev`, a seed script, a second replica on this or another host) refuses to start with "CommerceOS refused to start". Every flush re-checks the lock and stops writing if it no longer names this process. `COMMERCEOS_FORCE_LOCK=1` takes over a lock left by a host that is certainly gone.
> - Writes are coalesced and flushed asynchronously every `PERSIST_DEBOUNCE_MS` (default 250 ms), with an atomic rename. A crash can lose at most the last window. SIGTERM/SIGINT flush before exit.
> - `/health/ready` reports persistence health, data-dir writability and whether this process holds the lock, as booleans and a reason code (details go to the log). Route traffic only when it returns 200.
> - Rate limits and MFA replay state are held in process memory, which is another reason for one replica.
> - Set `replicas: 1` and a `Recreate` (not rolling) update strategy until FX-45. The lock refuses a second container on the same volume, but its identity is pid + host name, so containers must not share a fixed host name.

## 1. Containerization & Architecture Topology

CommerceOS deploys as containerized micro-services managed via Docker Compose (local/single-node) or Kubernetes (cloud cluster).

```
┌────────────────────────────────────────────────────────────┐
│                    DOCKER COMPOSE TOPOLOGY                 │
│                                                            │
│  [ app ] ─────────► [ postgres:16-pgvector ]               │
│  Next.js Core       Port 5432                              │
│  Port 3000                 │                               │
│        │                   │                               │
│        ▼                   ▼                               │
│  [ redis:7 ]                                               │
│  Port 6379                                                 │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 2. Environment Variables Configuration (`.env.example`)

```env
# Application
NODE_ENV=production
PORT=3000
APP_URL=https://app.commerceos.io
JWT_SECRET=super_secret_jwt_key_min_32_chars

# Database & Vectors
DATABASE_URL=postgresql://postgres:postgres_password@postgres:5432/commerceos
REDIS_URL=redis://redis:6379

# AI & LLM Providers
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
OLLAMA_BASE_URL=http://localhost:11434

# Integrations (Bangladesh Couriers & MFS)
STEADFAST_API_KEY=
STEADFAST_SECRET_KEY=
PATHAO_CLIENT_ID=
PATHAO_CLIENT_SECRET=
BKASH_APP_KEY=
BKASH_APP_SECRET=
BKASH_USERNAME=
BKASH_PASSWORD=

# Social Channels & Meta
META_APP_SECRET=
META_PAGE_ACCESS_TOKEN=
META_VERIFY_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=

# Platform Control Plane & Super Admin Security
PLATFORM_JWT_SECRET=super_secret_platform_jwt_key_min_64_chars_hex
PLATFORM_MFA_ISSUER=CommerceOS-Platform
PLATFORM_SESSION_TTL_SECONDS=900
PLATFORM_BREAK_GLASS_KEY_HASH=
PLATFORM_AUDIT_RETENTION_DAYS=730

```

---

## 3. Deployment & CI/CD Pipeline Workflow

1. **Lint & Type Check**: `npm run lint` && `npm run type-check`.
2. **Automated Testing**: Unit and integration test suites pass in clean CI runners.
3. **Multi-Stage Docker Build**:
   - Stage 1: Build dependencies and bundle Next.js standalone application.
   - Stage 2: Minimal Alpine runtime with unprivileged user execution.
4. **Database Migrations**: Executed via dedicated migration runner container before traffic cutover.
5. **Zero-Downtime Rolling Update**: Traffic shifts to new container replicas only after passing `/health/ready`.

