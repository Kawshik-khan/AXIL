# CommerceOS — Super Admin AI Gateway & Zero-Trust IAM Standalone Pages

> **Superseded (UI and navigation sections):** see `docs/super-admin-console-implementation-plan.md` and ADR-116. The pages this plan describes were never merged.
## Comprehensive Implementation Plan & Visual Interface Architecture

> **Document Type:** Production Engineering Blueprint & Interface Plan  
> **Target Systems:** Platform Control Plane (`src/app/super-admin/ai-gateway`, `src/app/super-admin/iam-forensics`, `src/domains/platform`, `src/app/api/v1/platform`)  
> **Status:** Implementation Plan — Ready for Review & Execution  
> **Governing Standards:** [GOVERNANCE.md](file:///g:/OLama/CommerceOS/.agent/GOVERNANCE.md), [tenant-isolation.md](file:///g:/OLama/CommerceOS/.agent/rules/tenant-isolation.md), [truthfulness.md](file:///g:/OLama/CommerceOS/.agent/rules/truthfulness.md), [security.md](file:///g:/OLama/CommerceOS/.agent/rules/security.md)

---

## 1. Executive Summary & Architecture Strategy

### 1.1 Goal
Create two dedicated, standalone operational command pages in the Super Admin platform control plane, accessible via persistent sidebar/dock buttons:
1. **AI Gateway & LLM Observability Suite** (`/super-admin/ai-gateway`)
2. **Enterprise Zero-Trust IAM & Support Forensics** (`/super-admin/iam-forensics`)

### 1.2 Non-Negotiables & Quality Standards
- **Dedicated Routed Pages:** Each system lives on its own Next.js App Router page with dedicated deep-linkable URLs (`/super-admin/ai-gateway` and `/super-admin/iam-forensics`).
- **Sidebar / Dock Integration:** A shared, persistent floating command dock on the left margin provides 1-click navigation between the main Command Center (`/super-admin`), the AI Gateway, and the Zero-Trust IAM console, with active route detection (`usePathname`).
- **100% Functional & Dynamic:** Every metric, queue item, trace, and session is loaded from real database collections and live domain services.
- **Strictly No Demo / Hardcoded Data:** Zero fake numbers, synthetic fallback strings, or `Math.random()`. If no data exists, the UI renders clean, truthful empty states (`"—"`, `"No active sessions"`, or `"No pending escalations"`).
- **Absolute Tenant Isolation:** The platform control plane inspects aggregate telemetry and masked buyer references (`018****92`). Cross-tenant queries never leak customer PII across workspace boundaries.
- **Privileged Step-Up Protection:** Destructive or high-risk actions (updating tenant AI usage budgets, launching/revoking JIT impersonations, exporting compliance manifests, or cryptographic wiping) require Step-Up MFA elevation.

---

## 2. Navigation Architecture & Unified Platform Dock

### 2.1 Shared Platform Navigation Dock (`src/app/super-admin/components/platform-nav.tsx`)
A reusable, detached glassmorphism dock rendered on the left margin across all `/super-admin/*` routes.

```
┌────────────────────────────────────────────────────────┐
│ DETACHED FLOATING DOCK (Left Margin, Fixed Position)   │
├────────────────────────────────────────────────────────┤
│ [📊] Command Center               -> /super-admin      │
│ [🏢] Fleet & Workspaces           -> /super-admin?tab=1│
│ [🤖] AI Gateway & Observability   -> /super-admin/ai-gw│ (New Dedicated Page)
│ [🛡️] Zero-Trust IAM & Forensics   -> /super-admin/iam  │ (New Dedicated Page)
│ [⚡] Automations & Workers         -> /super-admin?tab=2│
│ [🚨] Incident & Safety Command     -> /super-admin?tab=3│
├────────────────────────────────────────────────────────┤
│ [───] Divider                                          │
│ [🔍] Command Palette (⌘K)                              │
│ [🔑] Step-Up MFA Elevation                             │
└────────────────────────────────────────────────────────┘
```

The dock reads `usePathname()` to automatically highlight the active page and provides instant hover tooltips.

---

## 3. Page 1: AI Gateway & LLM Observability Suite (`/super-admin/ai-gateway`)

### 3.1 Visual Bento Grid Wireframe
```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ HEADER: AI GATEWAY & LLM FLEET OBSERVABILITY                                     [Dhaka BST] [Step-Up Status]   │
│ Subtitle: Cross-workspace token economics, live HITL escalations, adversarial defense & model routing.         │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ TOP HERO ROW (Span 12 - 4 Bento Cards of Col 3)                                                                 │
├───────────────────┬───────────────────┬───────────────────┬─────────────────────────────────────────────────────┤
│ 1. TOKEN ECONOMICS│ 2. RESOLUTION RATE│ 3. LATENCY & 429s │ 4. ACTIVE SAFETY GUARDS                             │
│ • Spend: $48.20   │ • Auto Rate: 84.2%│ • P95 Latency:    │ • Intercepted Injections: 19                        │
│   (৳5,784 BDT)    │ • Completed: 3,420│   680ms           │ • Intercepted Hallucinations: 42                    │
│ • Total: 3.8M tok │ • Human Esc: 642  │ • 429 Errors: 0%  │ • Pending HITL Escalations: 3                       │
├───────────────────┴───────────────────┴───────────────────┴─────────────────────────────────────────────────────┤
│ MIDDLE ROW: INTERACTIVE WORKSPACES (Span 12)                                                                    │
├───────────────────────────────────────────────────────────────┬─────────────────────────────────────────────────┤
│ CARD 1: LIVE HITL ESCALATION QUEUE (Span 8)                   │ CARD 2: TENANT AI BUDGETS & CONTROLS (Span 4)   │
│ Real-time customer sessions requiring human intervention.      │ Per-tenant token and cost limits.               │
│ Filter: [All Priority ▼] [Emotion: Any ▼]                     │ Filter: [Near Limit (>=80%) ▼]                  │
├─────────────┬─────────┬───────────┬───────────┬──────┬────────┤ Workspace: Dhaka Threads                        │
│ TENANT / CH │ BUYER   │ EMOTION   │ TRIGGER   │ WAIT │ ACTION │ • Spend: $14.20 / $20.00 (71% - OK)             │
├─────────────┼─────────┼───────────┼───────────┼──────┼────────┤ • Soft Cap: 80% ($16.00)                        │
│ Dhaka (WA)  │ 018***92│ FRUSTRATED│ LOW_CONF  │ 2m14s│ [Take] │ • Policy on Hard: Fallback to Rules             │
│ Aarong (FB) │ 017***10│ HOSTILE   │ INJECTION │ 45s  │ [Take] │ [Adjust Budget Caps (Step-Up)]                  │
│ Sylhet (Web)│ 019***44│ NEUTRAL   │ LOOP_ERR  │ 6m10s│ [Take] ├─────────────────────────────────────────────────┤
└─────────────┴─────────┴───────────┴───────────┴──────┴────────┤ Workspace: Chawk Bazaar Deals                   │
│                                                               │ • Spend: $19.80 / $20.00 (99% - CRITICAL!)      │
│                                                               │ • Action: Bot Muted -> Human Only               │
│                                                               │ [Adjust Budget Caps (Step-Up)]                  │
├───────────────────────────────────────────────────────────────┴─────────────────────────────────────────────────┤
│ BOTTOM ROW: SECURITY & ROUTING (Span 12)                                                                        │
├───────────────────────────────────────────────────────────────┬─────────────────────────────────────────────────┤
│ CARD 3: ADVERSARIAL PROMPT INJECTION DEFENSE (Span 6)         │ CARD 4: MODEL GATEWAY & FALLBACK HEALTH (Span 6)│
│ Log of blocked override attacks across Bangla/Banglish/English│ Real health and response times of LLM engines:  │
├────────────┬──────────┬───────────┬────────────┬──────────────┤ • Google Gemini 1.5 Flash (Primary)   [HEALTHY] │
│ TIME       │ TENANT   │ LANGUAGE  │ INPUT SNIP │ CONFIDENCE   │   - P95: 540ms | 0.0% Error Rate                │
├────────────┼──────────┼───────────┼────────────┼──────────────┤ • Google Gemini 1.5 Pro (RAG & Orders)[HEALTHY] │
│ 14m ago    │ Dhaka    │ Banglish  │ "ignore..."│ 98.4% (HIGH) │   - P95: 1,120ms | 0.0% Error Rate              │
│ 1h 20m ago │ Aarong   │ Bangla    │ "আগের নির্দেশ... 94.1% (HIGH) │ • OpenAI GPT-4o (Fallback Engine)     [STANDBY] │
│ 3h 10m ago │ Sylhet   │ English   │ "System:..." 99.2% (CRIT) │   - Zero traffic (Auto-failover armed)          │
└────────────┴──────────┴───────────┴────────────┴──────────────┴─────────────────────────────────────────────────┘
```

### 3.2 Dynamic Features & Modals
1. **Interactive Escalation Drawer (`Inspect / Take Over`):**
   - Displays full customer chat context, buyer emotional trajectory (`NEUTRAL` $\rightarrow$ `FRUSTRATED` $\rightarrow$ `HOSTILE`), model turn confidence score ($0–100$), and proposed order draft.
   - 1-Click Action: Operator claims ticket, which sets `conversation.automation_paused: true` and notifies merchant staff.
2. **Tenant AI Budget Adjustment Modal:**
   - Select workspace, update monthly dollar cap ($USD), soft-warning threshold ($80\%$), and hard cap action (`FALLBACK_TO_RULES` vs `PAUSE_AND_ESCALATE`).
   - Requires Step-Up elevation; writes directly to `TenantAiGuardSettingsRecord`.
3. **Prompt Injection Inspection Modal:**
   - View exact matched regex/semantic patterns (e.g., Bangla override `"আগের নিয়ম ভুলে যাও"` or Banglish `"dam 1 taka kore dao"`).

---

## 4. Page 2: Enterprise Zero-Trust IAM & Support Forensics (`/super-admin/iam-forensics`)

### 4.1 Visual Bento Grid Wireframe
```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ HEADER: ZERO-TRUST IAM, AUDIT & FORENSIC COMMAND                                 [Dhaka BST] [Step-Up Status]   │
│ Subtitle: Audited support impersonation, time-boxed operator access, forensic ledger & GDPR/BD compliance.     │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ TOP HERO ROW (Span 12 - 4 Bento Cards of Col 3)                                                                 │
├───────────────────┬───────────────────┬───────────────────┬─────────────────────────────────────────────────────┤
│ 1. ACTIVE SESSIONS│ 2. MFA ENFORCEMENT│ 3. OPERATORS FLEET│ 4. FORENSIC AUDIT EVENTS                            │
│ • Active JIT: 2   │ • Enforced: 100%  │ • Super Admins: 2 │ • 24h Events: 148 logs                              │
│ • Expiring <10m: 1│ • MFA Active: 4/4 │ • Support Ops: 2  │ • Privileged Mutations: 12                          │
│ • Revoked Today: 1│ • Step-Up Done: 1 │ • Security Ops: 1 │ • Denied / Blocked: 0                               │
├───────────────────┴───────────────────┴───────────────────┴─────────────────────────────────────────────────────┤
│ MIDDLE ROW: JIT IMPERSONATION & SESSIONS (Span 12)                                                              │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ CARD 1: TIME-BOXED JIT SUPPORT IMPERSONATION CONSOLE (Span 12)                                                  │
│ Action: [+ Launch New Audited JIT Session (Step-Up Required)]                                                   │
├─────────────┬──────────────────┬──────────────┬──────────────┬──────────────────┬───────────────────────────────┤
│ OPERATOR    │ TARGET WORKSPACE │ SUPPORT TICKET│ ACCESS MODE  │ REMAINING TIME   │ REVOCATION                    │
├─────────────┼──────────────────┼──────────────┼──────────────┼──────────────────┼───────────────────────────────┤
│ K. Rahman   │ Dhaka Threads    │ SUP-84291    │ READ_ONLY    │ 18m 42s [Active] │ [Revoke Session Immediately]  │
│ T. Ahmed    │ Aarong Crafts    │ SUP-84102    │ MUTATION_APP │ 4m 10s  [Active] │ [Revoke Session Immediately]  │
│ S. Khan     │ Sylhet Tea Co    │ SUP-83900    │ READ_ONLY    │ EXPIRED (Closed) │ — [Archived]                  │
├─────────────┴──────────────────┴──────────────┴──────────────┴──────────────────┴───────────────────────────────┤
│ MODAL: LAUNCH AUDITED JIT SESSION                                                                               │
│ • Target Workspace: [ Select Workspace... ▼ ]                                                                  │
│ • Zendesk / Jira Ticket ID: [ SUP-99120 ] (Mandatory)                                                           │
│ • Access Mode: (•) Read-Only Support (Default)   ( ) Mutation Approved (High Risk)                              │
│ • Time-Box Limit: [ 30 Minutes ▼ ] (Auto-terminates after expiry)                                               │
│ • Purpose & Justification: [ Investigating courier webhook synchronization delay for order #8841 ]              │
│ • [Cancel]  [Authorize & Launch Session (Step-Up MFA Required)]                                                 │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ BOTTOM ROW: OPERATORS, FORENSICS & COMPLIANCE (Span 12)                                                         │
├───────────────────────────────────────────────────────────────┬─────────────────────────────────────────────────┤
│ CARD 2: PLATFORM OPERATORS & RBAC MATRIX (Span 6)             │ CARD 3: TENANT COMPLIANCE EXPORT & PURGE (Span 6│
│ Active operators and privilege boundaries:                    │ Regulatory offboarding & data portability tools:│
├──────────────┬───────────────────┬──────────┬─────────────────┤ Workspace: [ Sylhet Tea Co (tenant-01) ▼ ]      │
│ OPERATOR     │ ROLE              │ MFA      │ LAST ACTIVE     │ Actions:                                        │
├──────────────┼───────────────────┼──────────┼─────────────────┤ [📦 Generate Compliance Data Export (JSON)]     │
│ K. Rahman    │ SUPPORT_SPECIALIST│ ENFORCED │ 4m ago          │    Downloads full JSON archive of orders, items,│
│ S. Khan      │ SUPER_ADMIN       │ ENFORCED │ 12s ago         │    customers & audit trails for offboarding.    │
│ Platform Sec │ PLATFORM_SECURITY │ ENFORCED │ 1h ago          │ [⚠️ Cryptographic Workspace Purge]              │
└──────────────┴───────────────────┴──────────┴─────────────────┤    Permanently wipes workspace data. Requires   │
│                                                               │    confirmation phrase + Two-Operator MFA.      │
├───────────────────────────────────────────────────────────────┴─────────────────────────────────────────────────┤
│ CARD 4: IMMUTABLE FORENSIC AUDIT LEDGER (Span 12)                                                               │
│ Search: [Filter by actor, action or IP...]   [Export Audit CSV]                                                 │
├────────────────────┬─────────────────┬──────────────────────────────┬──────────────────┬────────────────────────┤
│ TIMESTAMP          │ ACTOR           │ ACTION                       │ TARGET RESOURCE  │ CLIENT IP / INTEGRITY  │
├────────────────────┼─────────────────┼──────────────────────────────┼──────────────────┼────────────────────────┤
│ 2026-10-11 20:41   │ S. Khan         │ tenant.impersonate.launch    │ tenant-dhaka-01  │ 103.114.xx.xx [VALID]  │
│ 2026-10-11 20:30   │ K. Rahman       │ ai.guard.settings.update     │ tenant-aarong-02 │ 103.114.xx.xx [VALID]  │
│ 2026-10-11 19:15   │ S. Khan         │ platform.step_up.elevate     │ operator-01      │ 103.114.xx.xx [VALID]  │
└────────────────────┴─────────────────┴──────────────────────────────┴──────────────────┴────────────────────────┘
```

### 4.2 Dynamic Features & Modals
1. **Live JIT Session Countdown Timer:**
   - Uses real-time React interval calculating `Math.max(0, expires_at - now)` with visual status badge (`ACTIVE`, `EXPIRING_SOON`, `EXPIRED`).
2. **Instant 1-Click Revocation:**
   - Calls `POST /api/v1/platform/support/impersonate/revoke`, invalidates the token in DB, and terminates the active session immediately.
3. **One-Click Compliance Export:**
   - Calls `POST /api/v1/platform/compliance/export` with target `tenant_id`. Server packages all tenant data into a single downloadable JSON manifest with cryptographic checksum.
4. **Governed Cryptographic Purge:**
   - Offboards tenant only after the operator types `CONFIRM_PURGE_<slug>` and passes Step-Up verification.

---

## 5. Backend REST API Architecture

### 5.1 AI Gateway & Observability Endpoints
| Method | Path | RBAC Permission | Function |
|---|---|---|---|
| `GET` | `/api/v1/platform/ai/observability/radar` | `platform.read` | Macro AI fleet metrics: total tokens, USD/BDT cost, auto resolution rate, model latency. |
| `GET` | `/api/v1/platform/ai/hitl/queue` | `platform.read` | Platform-wide queue of customer conversations flagged for human escalation. |
| `POST` | `/api/v1/platform/ai/hitl/resolve` | `platform.support.write` | Resolves or takes over an escalated conversation; mutes bot automation. |
| `GET` | `/api/v1/platform/ai/traces` | `platform.read` | Filterable log of agent execution traces, including prompt injection blocks. |
| `PATCH`| `/api/v1/platform/ai/budget` | `platform.operations.write` (Step-Up) | Updates tenant monthly AI dollar/token budget and hard-cap policy. |

### 5.2 Zero-Trust IAM & Forensics Endpoints
| Method | Path | RBAC Permission | Function |
|---|---|---|---|
| `GET` | `/api/v1/platform/support/impersonate` | `platform.read` | Lists all active and past JIT impersonation sessions. |
| `POST`| `/api/v1/platform/support/impersonate` | `platform.support.write` (Step-Up) | Creates time-boxed JIT session with mandatory ticket ID. |
| `POST`| `/api/v1/platform/support/impersonate/revoke` | `platform.security.write` | Terminates active JIT session before expiry. |
| `GET` | `/api/v1/platform/audit` | `platform.read` | Immutable forensic log of all platform operations. |
| `GET` | `/api/v1/platform/users` | `platform.read` | Fleet of platform operators and their MFA statuses. |
| `POST`| `/api/v1/platform/compliance/export` | `platform.admin` (Step-Up) | Generates comprehensive tenant compliance data export. |
| `POST`| `/api/v1/platform/compliance/purge` | `platform.admin` (Step-Up) | Audited cryptographic wipe of offboarded tenant records. |

---

## 6. Implementation Phasing & File Layout

```
src/app/super-admin/
├── components/
│   ├── platform-nav.tsx                <-- Shared Floating Command Dock with URL routing
│   └── platform-header.tsx             <-- Shared Header (Time, Operator, Step-Up Status)
├── page.tsx                            <-- Command Center (Overview Dashboard)
├── ai-gateway/
│   └── page.tsx                        <-- Page 1: AI Gateway & LLM Observability Suite
├── iam-forensics/
│   └── page.tsx                        <-- Page 2: Enterprise Zero-Trust IAM & Support Forensics
├── agent-health-panel.tsx
├── automations-control-center.tsx
├── platform-client.ts
└── super-admin.module.css
```

### Execution Steps:
1. **Step 1: Shared Dock & Layout Components (`platform-nav.tsx` & `platform-header.tsx`)**
   - Extract the detached floating dock and top status bar into shared components.
   - Configure route navigation between `/super-admin`, `/super-admin/ai-gateway`, and `/super-admin/iam-forensics`.
2. **Step 2: Standalone AI Gateway Page (`src/app/super-admin/ai-gateway/page.tsx`)**
   - Build 12-column Bento Grid layout.
   - Connect live metrics to `/api/v1/platform/ai/observability/radar`.
   - Implement live HITL escalation table with transcript inspection drawer and claim actions.
   - Implement dynamic per-tenant AI budget adjustment modal.
   - Implement adversarial prompt injection defense feed.
3. **Step 3: Standalone Zero-Trust IAM & Forensics Page (`src/app/super-admin/iam-forensics/page.tsx`)**
   - Build 12-column Bento Grid layout.
   - Implement live JIT impersonation console with countdown timer and instant revocation.
   - Implement JIT session launch modal with mandatory support ticket and Step-Up elevation.
   - Implement operator fleet and RBAC matrix.
   - Implement tenant compliance export manifest generator.
   - Implement tamper-evident forensic audit table.
4. **Step 4: Clean Up & Truthfulness Guarantees**
   - Eliminate any remaining hardcoded strings or synthetic fallback literals.
   - Ensure clean empty states (`"—"`, `"No data yet"`) when records are empty.
5. **Step 5: Automated Testing & Verification**
   - `npm run type-check`: 0 errors.
   - Verify all GET routes remain 100% read-only (`node tests/ts-runner.cjs ./tests/phase2-readonly-tests.ts`).
   - Run security regression suite (`node tests/ts-runner.cjs ./tests/security-regression-tests.ts`).
