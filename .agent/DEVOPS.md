# CommerceOS DevOps & Deployment Guide

> **Status:** TARGET. No Dockerfile, Kubernetes, or CI exists; only `n8n/docker-compose.yml`. Env vars: see the real `.env.example` (Neon, Pinecone, Upstash).

> **Current constraint — exactly one replica (FIX_IMPLEMENTATION_PLAN FX-24, decision D3).** Until the Postgres cutover (FX-45), data lives in one JSON file, `.data/commerceos.json`, owned by one process:
> - At start the app takes `.data/commerceos.lock`. A second process on the same host (another `next dev`, a seed script, a second replica) is refused, and its `/health/ready` answers 503.
> - Writes are coalesced and flushed asynchronously every `PERSIST_DEBOUNCE_MS` (default 250 ms), with an atomic rename. A crash can lose at most the last window. SIGTERM/SIGINT flush before exit.
> - `/health/ready` reports persistence health, the last write error, data-dir writability and lock ownership. Route traffic only when it returns 200.
> - Rate limits and MFA replay state are held in process memory, which is another reason for one replica.
> - Set `replicas: 1` and a `Recreate` (not rolling) update strategy until FX-45. Two containers on one volume would corrupt each other's data; the lock only protects processes on the same host.

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
│  [ redis:7 ] ◄────► [ n8n:latest ]                         │
│  Port 6379          Port 5678                              │
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

---

## 4. Production n8n Orchestration Cluster & Deployment

### 4.1 Pinned Engine Version & Topology
- **Tested & Certified Version**: `n8n 1.76.0+` (Standard schema v1).
- **Service Port**: `5678`
- **Docker Compose Definition**:
```yaml
  n8n:
    image: docker.n8n.io/n8nio/n8n:1.76.0
    restart: always
    environment:
      - N8N_HOST=n8n.internal.commerceos.io
      - N8N_PORT=5678
      - N8N_PROTOCOL=https
      - NODE_ENV=production
      - WEBHOOK_URL=https://n8n.internal.commerceos.io/
      - GENERIC_TIMEZONE=Asia/Dhaka
      - COMMERCEOS_API_BASE_URL=http://app:3000
    volumes:
      - n8n_data:/home/node/.n8n
      - ./n8n/workflows:/n8n/workflows:ro
```

### 4.2 Credential Setup in n8n UI
Workflows strictly reference the generic HTTP Header credential named `"CommerceOS API"`:
1. Go to **Credentials** $\rightarrow$ **Add Credential** $\rightarrow$ **Header Auth**.
2. **Credential Name**: `CommerceOS API`
3. **Header Name**: `x-api-key`
4. **Header Value**: `<tenant_api_key>` (generated in CommerceOS Settings).

### 4.3 Automated Workflow Import
Workflows are delivered as real, validated JSON files in `/n8n/workflows/`:
```bash
# Bulk import all CommerceOS production workflows
docker exec -u node n8n n8n import:workflow --input=/n8n/workflows/commerceos-order-created-notification.json
docker exec -u node n8n n8n import:workflow --input=/n8n/workflows/commerceos-courier-status-sync.json
docker exec -u node n8n n8n import:workflow --input=/n8n/workflows/commerceos-payment-verification.json
docker exec -u node n8n n8n import:workflow --input=/n8n/workflows/commerceos-inventory-low-stock-alert.json
docker exec -u node n8n n8n import:workflow --input=/n8n/workflows/commerceos-abandoned-checkout-recovery.json
```
See `/n8n/deployment/import.md` for full production setup and validation steps.

