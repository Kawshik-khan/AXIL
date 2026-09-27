---
trigger: glob
description: Env config, readiness, headers, live-service commands
globs: next.config.js, package.json, .env.example, n8n/docker-compose.yml, src/app/health/**/*
---

# DevOps & Infrastructure Rules

Current reality: no Dockerfile, no CI, no git repository (STATUS.md). Items below marked TARGET are the standard to build toward.

1. **Configuration**: all runtime config comes from environment variables (12-factor). New variables go into `.env.example` with a placeholder value and a comment. Real values live only in `.env.local` (never read or edited by agents).

2. **Readiness**: `/health/ready` (`src/app/health/ready/route.ts`) must actually check the persistence layer and Redis, and return 503 when they're unavailable (currently always "ready", audit L3).

3. **Security headers**: `next.config.js` sets CSP, `X-Frame-Options`, `Referrer-Policy`, and HSTS (TARGET, audit L8).

4. **Containers** (TARGET): multi-stage Dockerfile, non-root `USER node`, production deps only.

5. **Version control** (TARGET): initialize git with a `.gitignore` covering `.env*` (except `.env.example`), `.data/`, `.next/`, `node_modules/`, `*.tsbuildinfo`, `.backups/`.

6. **Live services**: commands that touch Neon, Pinecone, Upstash, or n8n (`db:*`, `test:db`, `n8n:*`) need the user's go-ahead.
