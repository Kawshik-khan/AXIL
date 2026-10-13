# Super Admin Console — Implementation Plan

Date: 2026-10-12 · Status: IMPLEMENTED on the working tree (ADR-116); see §13 for what remains · Owner: platform
Workflow: every module below goes through `.agent/workflows/create-platform-feature.md` (15 steps).

This plan replaces the UI and navigation sections of `docs/super-admin-saas-platform-evolution-plan.md` and
`docs/super-admin-ai-gateway-and-iam-forensics-plan.md`. Their pages were never merged; only `page.tsx` and `login/`
exist under `src/app/super-admin/`. The billing engine itself (wallets, invoices, retry reminders for failed
payments) stays specified in `docs/saas-monetization-billing-plan.md`. This plan only defines the console surface
for billing.

---

## 0. Goal and hard rules

**Goal.** Turn `/super-admin` from one page (three empty tabs) into a working control plane with ten modules. Every
platform capability the backend already enforces must be reachable, and every risky lever must be governed.

**Hard rules (apply to every task in this plan):**

| # | Rule | How it is checked |
|---|---|---|
| R1 | **No hard-coded or demo values.** Every number, status, name, list and label that describes the system comes from an API response. Missing data renders "No data yet" or "Collecting telemetry", never `0`, `100%` or a sample. | `tests/super-admin-console-tests.ts` static scan (§9) + review |
| R2 | **No fallback identities.** The operator name, email and role come only from `GET /api/v1/platform/auth/session`. If they are missing, show an error state. | Static scan for `|| "SUPER_ADMIN"`-style fallbacks |
| R3 | **Tokens only.** Colors, radii, spacing, shadows and motion come from `src/styles/tokens.css`. No hex in `.tsx`; a value that has no token gets a new token. | Existing hook + static scan |
| R4 | **Same shell as the merchant app.** Same floating dock component and CSS, same canvas, same progressive blur, same ⌘K palette pattern. | Visual check of both apps |
| R5 | **Server is the authority.** UI hiding is a convenience. Every action is enforced by `PlatformAuthorizationService.assertCan`, `assertStepUp` and the new approval gate. | Security suites + `security-reviewer` |
| R6 | **GET never writes.** New read endpoints (attention inbox, impact preview, approvals list) compute values; they never store them. | `tests/phase2-readonly-tests.ts` |
| R7 | **Hairline is decoration, never data.** Figures show empty, all-clear, disconnected and sign-in states only. They never stand in for a chart or a number. | Review + §4 usage table |
| R8 | **Simulated stays visible.** A provider rail reporting `SIMULATED` is shown as SIMULATED, never as healthy. | Truthfulness suite |

---

## 1. Preconditions (before Phase A)

1. **Resolve the in-progress merge.** These files are unmerged (`UU`): `.agent/STATUS.md`, `.agent/DECISIONS.md`,
   `.gitignore`, and 18 files under `src/domains/ai/**`, `src/app/api/v1/ai/approvals/[id]`, `tests/ai-tests.ts`,
   `tests/eval-gate.ts`, `tests/ts-runner.cjs`. Commit or stash the unrelated working-tree changes, including the
   deleted `src/app/super-admin/agent-health-panel.tsx`, so this work starts from a clean branch
   (`feat/super-admin-console`).
2. **Confirm Hairline is properly installed.** `package.json` lists `@lucasmarkes/hairline@^0.5.0` (React ≥18 peer,
   ESM, no dependencies). Run `npm ls @lucasmarkes/hairline` and commit `package-lock.json` alongside it.
3. **Read the Next.js 16 docs** under `node_modules/next/dist/docs/01-app/`: route groups, private folders, layouts,
   and `params` (a Promise in server components; client pages use `useParams()`). The repo runs `next@16.3.7`, not 14.
4. **Baseline is green.** `npm run type-check` is 0 errors and `npm test` passes, so later regressions can be
   attributed.

---

## 2. Findings this plan fixes (evidence)

| ID | Where | Problem | Fixed in |
|---|---|---|---|
| SA-1 | `src/app/super-admin/page.tsx:60-65` | Hard-coded fallback operator (`admin@commerceos.bd`, `SUPER_ADMIN`). | A4 |
| SA-2 | `page.tsx:131` | Role badge reads `operator.platformRole`, which the session payload never contains (it sends `role`). It therefore **always** shows the literal `SUPER_ADMIN`, whatever the real role. Also a raw hex `#C7F900` in TSX. | A4 |
| SA-3 | `page.tsx:230-275` | Reads flat fields (`tenants_total`, `mrr_bdt`, `system_health_pct`, `active_incidents`), but `PlatformOverviewMetrics` is nested (`tenants.total`, `financials.mrr_bdt`, `infrastructure.open_incidents_count`). Result: tenants show "—", MRR always shows `৳0`, health always shows the made-up `100%`, incidents always `0`. Captions "All microservices operational" and "Zero uncontained breaches" are hard-coded claims. | A4 |
| SA-4 | `src/app/super-admin/layout.tsx:15` | Hard-coded canvas `#0f1013`; does not match the merchant shell or the tokens. | A2 |
| SA-5 | `src/app/api/v1/platform/safety/kill-switch/route.ts:19-20` | Request body is destructured without a strict Zod schema (breaks ADR-104). | B5 |
| SA-6 | `src/app/api/v1/platform/ai/hitl/takeover/route.ts:24` | A mutation (takeover) is gated only by `support.read`. | B5 |
| SA-7 | Platform-wide | No two-person approval exists. STATUS says `MUTATION_APPROVED` support sessions are refused until it does, and `rules/privileged-actions.md` §3.3 requires it for CRITICAL actions. | B1–B4 |
| SA-8 | `platform_announcements`, `platform_maintenance_windows` | Collections and permissions exist, but there is no service and no route. | J |
| SA-9 | `platform-subscription.service.ts:114` | `createPlanVersion` publishes every new version immediately (`is_published: true`); there is no draft. | C2 |
| SA-10 | `platform-subscription.service.ts:152` + `db.getPlanVersions` (insertion order) | `changeTenantPlan` takes the **first** published version. Every version is published, so tenants are moved to **v1**, the oldest price and limits. It also sets the period to 30 days even for ANNUAL, and turns a TRIAL into ACTIVE. | C2 |
| SA-11 | `platform-analytics.service.ts:95` | MRR adds `price_bdt` as monthly even when `billing_period` is `ANNUAL`, so annual subscriptions are counted 12× too high. | C2 |
| SA-12 | `platform-entitlement.service.ts:70` | `resolveLimit` applies plan limits only when the subscription is `ACTIVE`. TRIAL and PAST_DUE tenants silently fall back to the global defaults. | C1 (decision D7) |
| SA-13 | `PlanVersionRecord.features: Record<string, unknown>` | A plan can store any key, but only four are enforced (`max_users`, `max_products`, `max_channels` in `src/lib/safety-gate.ts`, and `ai_monthly_runs` in the agent runtime). Any other key looks like a limit but does nothing. | C1 |

---

## 3. Shell, navigation and design system

### 3.1 Route structure

```
src/app/super-admin/
  layout.tsx                    metadata only; canvas = var(--color-bg-base)          (edit)
  login/page.tsx                outside the shell; adds the Padlock figure (§4)       (edit)
  (console)/layout.tsx          PlatformShell: session, dock, top bar, palette        (new)
  (console)/page.tsx            Control Tower  → URL /super-admin                    (moved from page.tsx)
  (console)/tenants/page.tsx                 → /super-admin/tenants
  (console)/tenants/[id]/page.tsx            → /super-admin/tenants/:id
  (console)/billing/page.tsx                 → plans, subscriptions, entitlements, usage
  (console)/ai/page.tsx                      → AI governance
  (console)/automations/page.tsx             → n8n, workflows, DLQ, provider rails
  (console)/safety/page.tsx                  → kill switches, flags, incidents, maintenance, announcements
  (console)/security/page.tsx                → operators, sessions, impersonation, approvals, compliance
  (console)/audit/page.tsx                   → audit ledger
  (console)/insights/page.tsx                → commerce velocity, RTO network, funnel
  (console)/settings/page.tsx                → platform settings + versions
  _components/                  console-only components (private folder, not routed)
  _lib/                         platform-client.ts (moved), use-platform-resource.ts, module access, formatters
```

The route group `(console)` keeps the URL `/super-admin` while giving every console page one shared layout. The
login page stays outside that layout.

### 3.2 One dock component for both apps (merchant behavior unchanged)

The merchant dock (`src/components/navigation/FloatingNav.tsx` + `FloatingNav.module.css`) is a vertical column of
circular buttons fixed on the left: tooltip, active state, badge dot, divider, search, settings and log-out.

1. **Extract** `src/components/navigation/Dock.tsx`, a presentational component that takes:
   - `items: DockItem[]` (`label`, `href`, `icon`, `badge?`, `match?: "exact" | "prefix"`)
   - `onSearch?`, `settingsHref`, `onLogout`
   - It reuses `FloatingNav.module.css` unchanged.
2. **`FloatingNav` becomes a thin wrapper.** Merchant routes plus `canAccessPath`, passed into `Dock`. The default
   `match: "exact"` keeps today's merchant active-state behavior. **Merchant output must be pixel-identical**:
   screenshot before and after.
3. **`PlatformNav`** (`src/app/super-admin/_components/PlatformNav.tsx`) uses `Dock` with the platform items below,
   filtered by `canAccessPlatformPath(path, session.permissions)` in
   `src/app/super-admin/_lib/platform-module-access.ts`. That file mirrors `module-access.ts`. Platform items use
   `match: "prefix"`, so `/super-admin/tenants/abc` lights up Tenants.

**Dock items.** Every permission listed is the one the backend already enforces for that module's main read:

| Dock item | Path | lucide icon | Read permission (enforced in) |
|---|---|---|---|
| Control Tower | `/super-admin` | `LayoutDashboard` | `platform.read` (`PlatformAnalyticsService.getPlatformOverview`) |
| Tenants | `/super-admin/tenants` | `Building2` | `tenant.read` (`PlatformTenantService.listTenants`) |
| Billing & Plans | `/super-admin/billing` | `CreditCard` | `plan.read` (`PlatformSubscriptionService.listPlans`) |
| AI Governance (badge "AI") | `/super-admin/ai` | `BrainCircuit` | `platform.read` (`ai/*` routes) |
| Automations | `/super-admin/automations` | `Workflow` | `automation.read` (`platform/automations`) |
| Safety & Releases | `/super-admin/safety` | `Siren` | `security.read` (`PlatformSafetyService.getKillSwitches`) |
| Security | `/super-admin/security` | `ShieldCheck` | `support.read` (`PlatformSupportService.listSessions`) |
| Audit | `/super-admin/audit` | `ScrollText` | `audit.read` (`platform/audit`) |
| Insights | `/super-admin/insights` | `TrendingUp` | `analytics.platform.read` (`rto/radar`, `ai/observability/radar`) |
| — divider, Search (⌘K), Settings `/super-admin/settings` (`platform_config.read`), Log out | | | |

`platform-module-access.ts` is the single map. Phase A adds a test asserting that every dock item has an entry and
that each permission exists in `PLATFORM_PERMISSIONS`.

### 3.3 PlatformShell (`(console)/layout.tsx`)

It mirrors `src/app/(dashboard)/layout.tsx`, with the same structure and classes:

- `GET /api/v1/platform/auth/session` loads `{ user, role, permissions, mfaVerified, stepUpVerified, scope }`.
  A 401 goes to `/super-admin/login`; any other failure shows `ErrorState` with `request_id` and Retry. **No identity
  fallback.**
- The same progressive-blur stack and `mainWrapper` offset as the merchant shell. Reuse `dashboard.module.css`
  classes by moving the shared shell rules into `src/components/navigation/Shell.module.css`, imported by both
  layouts (pixel-identical merchant check again).
- `PlatformSessionContext` gives pages the session (permissions, role, step-up state) without refetching.
- `PlatformTopBar`:
  - Operator name and **real** role (from `session.role`); MFA badge from `mfaVerified`.
  - Step-up countdown while a step-up token is held (§5.3).
  - Live clock in Dhaka time via `Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka" })`.
  - Pending-approvals counter from `GET /api/v1/platform/approvals?status=PENDING` (Phase B).
  - Refresh, Sign out, and Sign out everywhere (`POST /auth/sessions/revoke-all`).
- Global banners: an active GLOBAL kill switch and active maintenance windows come from the same GET calls the
  Safety page uses. They are never hard-coded.
- `PlatformCommandPalette` (⌘K) uses the visual pattern of `CommandPalette.tsx`, with platform data:
  - module jumps (filtered by permission)
  - tenant search via `GET /api/v1/platform/tenants?search=<q>&limit=8`
  - an "open audit for tenant" shortcut

### 3.4 Color and surface mapping

The merchant canvas and the platform canvas are the same: `--color-bg-base`. The token table in
`.agent/rules/platform-ui.md` §1 already specifies it. The platform's "dark variant" identity lives in the cards.

| Surface | Token |
|---|---|
| Page canvas | `--color-bg-base` |
| Standard card | `--color-surface-pure`, border `--color-border-subtle`, radius `--radius-card` |
| Hero and command cards (KPI strip, attention inbox, kill-switch panel) | `--color-surface-dark` / `--color-dark-card`, text `--color-text-inverse` / `--color-text-dark-muted`, border `--color-border-dark` |
| Accent and active dock item | `--color-lime-primary`, hover `--color-lime-hover`, glow `--color-lime-glow` |
| Status | `--color-success`, `--color-warning`, `--color-danger`, `--color-info` and their `-bg` pairs |
| CRITICAL action zone | `--color-danger-bg` panel with a `--color-danger` border, physically separated from routine controls |
| Motion | `--transition-fast`, `--transition-normal`, `--transition-smooth` |

Layout follows the frontend-design page recipe: 12-column Bento grid (`BentoGrid` / `BentoCard`), 16px gap, KPI
cards span 3, tables and charts span 8–12, 6 columns below 1024px and 1 column below 640px.

**Update `.agent/rules/platform-ui.md` §2.2.** It currently says the dock gives "quick access to the 18 primary
operational areas". Change it to: the platform dock is the merchant `Dock` component with the ten modules above.

---

## 4. Motion system with Hairline

`@lucasmarkes/hairline` provides 33 isometric line figures that react to the pointer, filling the parent's width at
5:4. All figures share one `requestAnimationFrame` loop, do no work off-screen, honor `prefers-reduced-motion`, and
render an empty 5:4 box on the server, so nothing shifts on load. They are illustrations, so (R7) **they never carry
data**.

### 4.1 Wrapper: `src/components/motion/HairlineFigure.tsx`

```tsx
"use client";
// Illustration only (R7): never pass metrics; onRead captions are not shown.
type FigureKind =
  | "all-clear" | "empty-list" | "no-data" | "no-results" | "filtered-out"
  | "queue-empty" | "disconnected" | "network-empty" | "releases-empty"
  | "infrastructure-empty" | "log-empty" | "sign-in";

interface HairlineFigureProps {
  kind: FigureKind;
  surface?: "light" | "dark";        // selects the token mapping below; default "light"
  size?: "sm" | "md";                // sm 160px, md 220px wide (5:4)
}
```

- Each `kind` maps to a figure (table below). Each figure is loaded with `next/dynamic` from
  `@lucasmarkes/hairline/react`, so a page pays only for the figures it shows.
- `theme` is set explicitly from `surface` (`"light"` / `"dark"`), never `"auto"`, so the figure always matches the
  card behind it.
- `intensity` is a constant in the wrapper (0.4). `play` is `true` only for `sign-in`, and the library already
  rests it under reduced motion.
- `aria-hidden="true"`: the adjacent EmptyState title and description carry the meaning.
- At most one figure per card, and never inside dense tables or KPI tiles.

### 4.2 Token-mapped theme: `src/components/motion/HairlineFigure.module.css`

```css
.light { --hairline-plate: var(--color-surface-pure); --hairline-hi: var(--color-text-primary);
         --hairline-edge: var(--color-text-secondary); --hairline-mid: var(--color-text-muted);
         --hairline-lo: var(--color-border-medium); --hairline-stroke: 0.9; }
.dark  { --hairline-plate: var(--color-dark-card); --hairline-hi: var(--color-lime-primary);
         --hairline-edge: var(--color-text-dark-muted); --hairline-mid: var(--motion-line-mid-dark);
         --hairline-lo: var(--color-border-dark); --hairline-stroke: 0.9; }
```

`--hairline-plate` must equal the surface the figure sits on (library README). Two steps follow from that:

- If the dark mid-stroke has too little contrast, add `--motion-line-mid-dark` to `tokens.css`; no hex in components.
- Verify the plate against the `States` container background and adjust the mapping, not the component.

### 4.3 Where each figure appears

| Kind | Figure | Why it fits | Used in |
|---|---|---|---|
| `all-clear` | `Settle` (crooked tiles settle into a tree) | "Everything is in order" | Control Tower attention inbox with 0 items |
| `empty-list` | `Drawer` (drawer opens, nothing inside) | Empty collection | Tenants, plans, operators, approvals, announcements with no rows |
| `no-data` | `Plot` (bars are flat tabs at zero) | Honest "no values yet" | Insights and AI charts when the API returns no points or `null` rates |
| `no-results` | `Query` | Search found nothing | Tenant search, ⌘K palette, audit search |
| `filtered-out` | `Sieve` | Filters removed everything | Tenant and audit filters |
| `queue-empty` | `Basket` (bare floor) | Nothing waiting | DLQ, HITL queue, pending approvals |
| `disconnected` | `Plug` (plug stops short of the socket) | Not connected | Provider rail `SIMULATED`/`DOWN`, n8n unreachable |
| `network-empty` | `Hub` | No links yet | Integrations or RTO network with no data |
| `releases-empty` | `Branches` | No versions | Feature flags, agent rollouts with none defined |
| `infrastructure-empty` | `Cabinet` | No blades | n8n instances / workers with none registered |
| `log-empty` | `Terminal` | No history | AI traces, incident timeline |
| `sign-in` | `Padlock` (shackle lifts as you approach) | Unlocking | `/super-admin/login` only |

`EmptyState` (`src/components/ui/States/States.tsx`) gains an optional `illustration?: React.ReactNode` prop,
rendered above the title in place of the 28px icon. Existing callers are unchanged.

**Not Hairline:**
- Loading uses `LoadingSkeleton` (platform-ui.md §2.3: skeletons, not spinners).
- Access-denied keeps the static `PermissionDenied`. An opening padlock would send the wrong message.

### 4.4 Other motion (tokens only)

- Card hover lift, dialog enter, dock tooltip and toast: existing `--transition-*` tokens.
- **No count-up animation on numbers.** It shows values that never existed, which conflicts with R1.
- Status changes (e.g. a kill switch turns on) use a single color transition, not a looping pulse. The only
  persistent indicator is the existing status dot on live states.
- Every non-Hairline animation is wrapped in `@media (prefers-reduced-motion: no-preference)`.

---

## 5. Shared client and governance primitives

### 5.1 Data hook: `src/app/super-admin/_lib/use-platform-resource.ts`

```ts
type ResourceState<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: T; meta?: Record<string, unknown>; fetchedAt: string }
  | { kind: "empty"; fetchedAt: string }
  | { kind: "error"; message: string; requestId?: string; status: number }
  | { kind: "forbidden"; permission?: string };

function usePlatformResource<T>(
  url: string | null,
  opts?: { isEmpty?: (d: T) => boolean; refreshMs?: number }
): { state: ResourceState<T>; reload: () => void };
```

- Built on `platformFetch`; a 401 already redirects. A 403 maps to `forbidden` with the permission name from the
  error envelope.
  - If `PlatformPermissionDeniedError` does not include `details.permission` yet, add it in A3.
  - Name the permission, nothing more sensitive (platform-ui.md §2.3).
- `refreshMs` polls only while `document.visibilityState === "visible"`. The Control Tower uses 60s; everything else
  refreshes manually.
- Each card shows "as of HH:MM (Dhaka)" from `fetchedAt`, so stale data is visible.
- `<ResourceView state renderReady emptyFigure emptyTitle emptyDescription />` renders the six UX states:
  loading, ready, empty (with Hairline), error (request id + Retry), forbidden (`PermissionDenied`), and
  unauthorized (redirect).

**Response types.** Import types from the domain services with `import type` (erased at build, so no server code
reaches the client). For example, `PlatformOverviewMetrics` comes from `platform-analytics.service.ts`. This is what
prevents a repeat of SA-3: renaming a field breaks type-check instead of silently showing `—`.

### 5.2 Privileged-action registry: `src/domains/platform/privileged-actions.ts` (pure data, client-safe)

One declaration per action, following `rules/privileged-actions.md` §3.1:

```ts
export interface PrivilegedActionSpec {
  key: string;                       // "tenant.suspend"
  risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  permission: PlatformPermission;
  stepUp: boolean;
  approval: "never" | "always" | "if_tenant_older_than_30d";
  reasonMin: number;                 // 10 for MEDIUM+
  ticketRequired: boolean;           // HIGH/CRITICAL
  confirmPhrase?: (target: { slug?: string; label: string }) => string; // CRITICAL
  inverse?: string;                  // key of the undo action, for reversible MEDIUM actions
  rollback: string;                  // the documented recovery path
}
```

- `PlatformAuthorizationService.classifyRisk` reads from this registry. The duplicated lists at
  `platform-authorization.service.ts:20-45` are removed.
- The server enforces through `PrivilegedActionGate.assert(context, key, { reason, ticketRef, approvalId,
  payload })`: permission → step-up → reason/ticket → approval binding. It fails closed with `StepUpRequiredError`
  or `ApprovalRequiredError` (rule §3.4).
- The client uses the same spec to decide which dialog steps to show. **The UI never decides whether an action is
  allowed; it only decides what to ask for.**

### 5.3 Step-up on the client

- `useStepUp()` calls `POST /api/v1/platform/auth/step-up` with a TOTP code and keeps the returned token **in memory
  only** (React state, never `localStorage`). It sends the token via `platformFetch(..., stepUpToken)` and drops it
  at expiry (≤300s) or right after a CRITICAL action.
- The top bar shows the remaining time.

### 5.4 `PrivilegedActionDialog` (`src/app/super-admin/_components/PrivilegedActionDialog.tsx`)

The steps shown depend on the spec:

1. **Impact preview.** Loaded from `GET /api/v1/platform/impact?action=&scope=&target=` (new, read-only). It returns
   real counts: affected tenants, running automations, open conversations, active subscriptions. If the endpoint
   cannot compute a count, it says so; it does not guess.
2. **Reason.** Must meet `reasonMin`. HIGH and CRITICAL also need a ticket or incident reference.
3. **Typed confirmation** for CRITICAL. The phrase comes from `confirmPhrase(target)`, e.g. `CONFIRM_PURGE_<slug>`
   (already used by compliance purge).
4. **Step-up TOTP**, inline if no valid token is held.
5. **Execute, or request approval.**
   - When approval is required, the dialog creates an approval request and shows "Waiting for a second operator".
   - The action becomes executable from the Approvals inbox once approved.
6. **Result.** A success toast with an Undo button when the spec has an `inverse`, or an error with `request_id`.

### 5.5 Two-person approval (backend, new) — closes SA-7

- **Collection** `platform_approval_requests`: platform scope, stored as JSONB documents (not in `CORE_TABLES`),
  added to `DatabaseSchema` and its loader default in `src/infrastructure/db/index.ts`, and to
  `NEWEST_FIRST_COLLECTIONS`. Fields:
  - `id`, `action_key`, `target_type`, `target_id`
  - `payload` (sanitized) and `payload_hash` (SHA-256 of the canonical JSON)
  - `reason`, `ticket_ref`, `requested_by`, `requested_at`, `expires_at` (default 60 min, from a platform setting)
  - `status` (`PENDING | APPROVED | REJECTED | CANCELLED | EXECUTED`)
  - `decided_by`, `decided_at`, `decision_note`, `executed_at`, `executed_request_id`
- **`PlatformApprovalService`**: `request`, `list`, `decide`, `cancel`, `consumeForExecution`.
- **Invariants** (each one gets a test):
  - The approver is never the requester.
  - The approver holds the new permission `approval.decide` (granted to `SUPER_ADMIN` and `PLATFORM_SECURITY`) **and**
    the action's own permission.
  - Deciding requires step-up.
  - Execution needs an `APPROVED` request whose `payload_hash` matches the execution payload exactly, that has not
    expired, and that has not been used. Consumption is atomic and single-use inside the unit of work.
  - Expiry is **derived on read** (`now > expires_at` → shown as expired). GET never writes it (R6).
  - Every transition writes a platform audit entry. A refused attempt is kept with
    `db.keepEvenIfRequestFails`.
- **Routes:**
  - `GET/POST /api/v1/platform/approvals`
  - `POST /api/v1/platform/approvals/[id]/decision` (`{ decision: "APPROVE"|"REJECT", note }`)
  - `POST /api/v1/platform/approvals/[id]/cancel`
  - All with strict Zod bodies and wrapped in `withStore`.
- **Open decision D3 (§11):** with only one operator who holds `approval.decide`, CRITICAL actions cannot run. That
  is intended (no break-glass in this plan).
- After this ships, `MUTATION_APPROVED` impersonation can be built on it. That is a separate task, not in this plan.

---

## 6. Modules

Each module lists data sources (**existing** = route exists today; **new** = this plan adds it), sections, actions
with risk tiers, and acceptance criteria. All actions go through §5.4.

### A. Control Tower — `/super-admin`

**Data sources:**
- Existing: `GET /platform/overview` (`PlatformOverviewMetrics`).
- New: `GET /platform/attention`.
- Existing: `GET /platform/audit?limit=10`.
- New (Phase B): `GET /platform/approvals?status=PENDING`.

**Layout, top to bottom:**
1. **Status strip (dark):**
   - GLOBAL kill state (`infrastructure.kill_switch_active`)
   - open incidents (`infrastructure.open_incidents_count`)
   - active maintenance window (Phase J)
   - Dhaka clock
2. **KPI row**, 4 × span-3, values straight from `overview`. A `null` value shows "No data yet".
   - Tenants: `tenants.total`, sub-line `active / trial / suspended`.
   - MRR: `financials.mrr_bdt` formatted with `financials.currency`, sub-line ARR and ARPU.
   - GMV: `commerce_velocity.total_gmv_bdt`, sub-line orders and COD %.
   - AI spend: `ai_fleet.estimated_cost_bdt`, sub-line tokens and autonomous resolution rate.
3. **Attention inbox** (span 8, dark) from the new `GET /platform/attention`. Items are computed live, never stored:
   - entitlement usage ≥ threshold, from `getTenantEntitlementsStatus`
   - open incidents
   - active kill switches
   - `dlq_items_count > 0`
   - HITL items waiting longer than the threshold
   - pending approvals
   - active operators without MFA
   - active impersonation sessions
   - provider rails `DOWN`/`DEGRADED`

   Each item has `{ id, severity, category, title, detail, count, href, observed_at }`. Thresholds are platform
   settings with defaults as named constants in the service, never literals in the UI. With zero items, it shows the
   empty state with `Settle`: "Nothing needs attention".
4. **Subsystem health** (span 4): one row per provider rail and per infrastructure field, showing `HEALTHY`,
   `DEGRADED`, `DOWN` or **`SIMULATED`** exactly as reported (R8). `SIMULATED` uses the `disconnected` figure when
   every rail is simulated.
   - **The "Platform Health %" tile is removed.** No API computes it.
5. **Recent privileged actions** (span 12): the last 10 platform audit entries, each linking to the Audit module.

**Acceptance:**
- With an empty store, every KPI shows "No data yet", not `0`/`৳0`/`100%`, and the inbox shows the all-clear state.
- With one suspended tenant and one open incident, both appear in the strip and the inbox, with working links.
- An analyst role sees the page, but every action control is hidden.

### B. Tenants — `/super-admin/tenants` and `/super-admin/tenants/[id]`

**List data:** existing `GET /platform/tenants?search&status&plan_id&limit&offset` (returns `meta.total`).
- Table with server-side search, status and plan filters, and pagination from `meta`.
- Filter state lives in the URL query, so views can be shared.
- Empty states: `empty-list`, `no-results` or `filtered-out`, depending on the cause.
- "Provision tenant" (`tenant.create`, MEDIUM) uses the existing `POST /platform/tenants` (owner setup link flow,
  N8).

**Tenant 360° view** (`[id]`):

| Tab | Source | Notes |
|---|---|---|
| Overview | existing `GET /platform/tenants/[id]` | Status, plan, created date, owner, channels. **Step B-0:** list the detail response; add any missing field in `getTenantDetail`, never in the UI |
| Usage & limits | existing `GET /platform/entitlements?tenant_id=` (`getTenantEntitlementsStatus`) | Bar per entitlement (`used / limit`); override action |
| Subscription | existing `GET /platform/subscriptions?tenant_id=` | Current plan version, history |
| AI | existing `GET /platform/ai/budget?tenant_id=`, `GET /platform/ai/traces?tenant_id=` | Budget caps, spend, recent traces (PII redacted by the API) |
| Support | existing `GET /platform/support/impersonate` | Session history; start a read-only session |
| Audit | existing `GET /platform/audit?targetId=` | Entries about this tenant |

Confirm each `?tenant_id=` filter in step B-0. Where one is missing, add it server-side to the route and its service.

**Actions:**

| Action | Key | Risk | Server |
|---|---|---|---|
| Suspend | `tenant.suspend` | HIGH (step-up; approval if tenant is older than 30 days) | existing `POST /tenants/[id]/suspend` |
| Reactivate | `tenant.activate` | MEDIUM | existing `POST /tenants/[id]/activate` |
| Change plan | `subscription.manage` | MEDIUM | existing `POST /platform/subscriptions` (`changeTenantPlan`) |
| Entitlement override with expiry | `entitlement.manage` | HIGH | existing `POST /platform/entitlements` (`setTenantOverride`); add `expires_at` if absent |
| Start read-only support session | `support.impersonate` | HIGH | existing `POST /support/impersonate` (`READ_ONLY`) |
| Archive | `tenant.archive` | HIGH | `archiveTenant` exists in the service; add a route if none |
| Purge | `tenant.purge` | CRITICAL (approval + typed slug) | existing `POST /platform/compliance/purge`. **Verify** it keeps the 14-day tombstone required by privileged-actions §3.5 before exposing it |

**Acceptance:**
- Suspending without step-up returns `STEP_UP_REQUIRED`, and the dialog prompts for it.
- Purge without an approved request is refused.
- After an action, the page refetches and the audit tab shows the entry.

### C. Plans, Catalog & Customization Studio — `/super-admin/billing`

**Principle: you can customize anything the system actually enforces.** A setting that can be edited but changes
nothing is a fake control, which breaks R1. So customization is **driven by a schema**:

- Every customizable thing is declared once in code: its type, bounds, scope, risk tier, and **the code that
  enforces it**.
- The console builds its forms from those declarations.
- The server rejects any key that isn't declared.
- Adding a *new kind* of limit, say "max warehouses", needs a developer once: write the counter, add the gate, add the
  catalog entry. After that it is fully customizable from the console, for every plan and tenant, with no deploy.

Value precedence, shown in the UI for every key (the Effective Value Inspector):

```
tenant override (unexpired) → plan version value + active add-ons → global default → not gated
```

**Tabs:** Plans · Entitlement catalog · Add-ons · Trials & lifecycle · Subscriptions · Coupons¹ · Invoices¹
(¹ appear only when the billing-engine routes exist; see C6.)

#### C1. Entitlement catalog — `src/domains/platform/entitlement-catalog.ts` (new, code-declared)

```ts
export interface EntitlementSpec {
  id: string;                        // "max_products"
  label: string;                     // shown in the console
  kind: "COUNT_LIMIT" | "PERIOD_QUOTA" | "FEATURE" | "TIER";
  unit?: string;                     // "users", "products", "AI runs"
  period?: "MONTH";                  // PERIOD_QUOTA only
  tiers?: readonly string[];         // TIER only, e.g. AI model tiers
  min?: number; max?: number;        // bounds validated on every write
  allowUnlimited: boolean;           // null in a plan = not gated
  enforcedBy: string | null;         // "src/lib/safety-gate.ts#assertWithinLimit" — null = NOT ENFORCED
  addonEligible: boolean;
}
```

- **Enforced now** (`enforcedBy` set): `max_users`, `max_products`, `max_channels`, `ai_monthly_runs`. These four are
  editable on plans, overrides and add-ons.
- **Declared but not enforced** (`enforcedBy: null`): listed in the console with an **"Not enforced yet"** badge. They
  **cannot** be put on a plan until their gate ships. Candidates, each a small separate task:
  - module access (`module.intelligence`, `module.growth`, `module.marketing`, `module.automations`,
    `module.connectors`, `module.conversations`), as FEATURE entitlements enforced in the route guard and hidden in
    the dock
  - `orders_monthly`
  - `outbound_messages_monthly`
  - `automations_max_active`
  - `warehouses_max`
  - `ai_model_tier`, enforced by the model router
- **Global defaults** stay in the existing `entitlements` collection (`EntitlementRecord.default_value`).
  - `GET /platform/entitlements` returns catalog plus defaults.
  - Changing a default affects every tenant without a plan value, so it is **HIGH + approval**.
- **Plan features are validated against the catalog** with a strict Zod schema built from it. Existing stored keys
  that aren't in the catalog are shown as "Unknown key (ignored)" and can be removed. They are never silently
  enforced.
- **Fix SA-12:** under decision D7, TRIAL subscriptions get their plan version's limits, and PAST_DUE keeps them
  during the grace period (C4).

#### C2. Plan builder (versioned, draft → published)

**Plan identity** (`PlanRecord`; new optional fields):
- `visibility`: `PUBLIC | HIDDEN | PRIVATE`. PRIVATE means a custom plan for named tenants.
- `display_order`, `highlight_label` (operator-entered text such as "Most popular"; stored data, not hard-coded).
- `is_active`.

**Version** (`PlanVersionRecord`; new optional fields, all backward compatible):
- `status`: `DRAFT | PUBLISHED | RETIRED`. Replaces the meaning of `is_published`, which is kept in sync for old
  readers.
- `monthly_price_bdt` and `annual_price_bdt` (both optional; at least one required to publish). The legacy pair
  `price_bdt` / `billing_period` is read as one of them.
- `trial_days`, `setup_fee_bdt`.
- `features`: values for catalog entitlements only.
- `change_note`, `published_by`, `published_at`.

**Rules:**
- A **published version is immutable.** "Edit" creates a new DRAFT copied from it, which fixes SA-9.
- New subscribers get the **latest** PUBLISHED version.
- Existing subscribers stay on their version (grandfathered) until they are migrated (C5).
- Version ids use cryptographic ids, not `v${count}`.
- "Retire" stops new sign-ups on that version. Current subscribers are unaffected.
- **Fix SA-10:** `changeTenantPlan` picks the latest published version, accepts a billing period, sets the period end
  from it, and keeps TRIAL status unless "end trial now" is chosen.
- **Fix SA-11:** MRR counts `annual_price_bdt / 12` for annual subscriptions.

**Editor UI:**
- Left: identity and pricing.
- Center: the entitlement matrix, generated from the catalog. It has number inputs with bounds, an "Unlimited"
  toggle, FEATURE switches and TIER selects; "Not enforced yet" rows are disabled.
- Right: a live **diff against the current published version** and a **comparison with other plans**.
- Actions:
  - Save draft (LOW)
  - Publish (MEDIUM: affects new subscribers only)
  - Clone plan
  - Retire version (MEDIUM)

#### C3. Add-ons (new)

- **`platform_addons`:** `{ id, name, description, entitlement_id, increment, monthly_price_bdt, status, allowed_plan_ids[] }`.
  For example "+5 users", "+1 WhatsApp channel", "+1,000 AI runs". Only catalog entries with `addonEligible: true`
  can be chosen.
- **`tenant_addons`:** `{ id, tenant_id, addon_id, quantity, source: "PURCHASED" | "COMPLIMENTARY", starts_at,
  ends_at?, granted_by, reason, ticket_ref }`.
- **`resolveLimit`** becomes: the plan value plus the sum of active add-on increments. "Active" is derived from
  `starts_at` / `ends_at` at read time, so nothing is written on read.
- Until the billing engine exists, operators can grant add-ons as **COMPLIMENTARY** only (MEDIUM, reason required).
  PURCHASED arrives with the billing engine.

#### C4. Trials & lifecycle policy

These are typed settings in the registry (J2), with code-constant defaults:
- `billing.trial_default_days`
- `billing.past_due_grace_days`
- `billing.after_grace_action` (`READ_ONLY` | `DOWNGRADE_TO_PLAN:<id>` | `SUSPEND`)
- `billing.trial_end_reminder_days`

Per-tenant actions in Tenant 360 → **Commercial** tab:
- Extend trial (MEDIUM; new end date, bounded by a max-extension setting)
- Change plan or version
- Grant add-on
- Entitlement override **with `expires_at`** (HIGH; `TenantEntitlementRecord` gains `expires_at`, `granted_by`,
  `ticket_ref`; an expired override is ignored at read time)
- Assign a PRIVATE plan (custom enterprise deal)

`after_grace_action` only takes effect once the billing engine's daily job exists. Until then the console shows the
policy as **"Saved — not enforced until billing jobs ship"**.

#### C5. Plan migration (move tenants between versions or plans)

- `GET /platform/plans/impact?from_version=&to_version=` (read-only) computes the effect from real counts:
  - number of tenants affected
  - for each lowered limit, how many tenants are **already above** the new value (from the `CURRENT_COUNT` counters
    and usage records)
  - the MRR change
- `POST /platform/plans/migrate`: `{ from_version_id, to_version_id, tenant_ids? | all: true, effective: "NOW" |
  "NEXT_PERIOD", reason, ticket_ref }`.
  - Risk is **HIGH**, with approval when the number of affected tenants is above the setting
    `plans.migration_approval_threshold`.
  - Runs as one unit of work and writes one audit entry per tenant plus one summary entry.
- **Meaning of a lowered limit**, stated in the dialog: existing data is kept; new additions are blocked while the
  tenant is above the limit (that is how `assertWithinLimit` already counts).

#### C6. Depends on the billing engine (`docs/saas-monetization-billing-plan.md`)

These tabs and fields appear **only once the billing-engine routes exist**; no placeholders:
- Platform coupons (`platform_coupons`, separate from merchant `coupons`): percent or fixed BDT, duration
  (once / N months / forever), max redemptions, valid plans, expiry.
- Overage pricing per PERIOD_QUOTA entitlement.
- Invoices, payment-failure reminders, wallets, PURCHASED add-ons.
- VAT/tax rate, from a setting. The legal rate is confirmed by finance, not assumed in code.

#### C7. Merchant-facing pricing is also dynamic

The merchant upgrade page reads public plans from a tenant-scoped `GET /api/v1/billing/plans`: PUBLIC + PUBLISHED
only, prices and catalog labels included. A price or limit change in the console then appears for merchants without
a deploy. This is a follow-up task in the merchant app, because it sits outside `/super-admin`.

**Revenue (unchanged):** `overview.financials` (MRR/ARR/ARPU, corrected for annual plans by SA-11).

### D. AI Governance — `/super-admin/ai`

Existing routes:
- `GET /ai/agent-health` (token costs, P95, 429s, alerts)
- `GET /ai/agent-rollout`
- `GET/PATCH /ai/budget` (PATCH: `platform.manage` + step-up, HIGH)
- `GET /ai/hitl/queue`
- `POST /ai/hitl/takeover`
- `GET /ai/traces`
- `GET /ai/observability/radar` (prompt-injection radar)

**Sections:**
- Fleet health table
- Budgets: platform → tenant caps; soft/hard thresholds come from the API
- Rollout status per agent version
- HITL command queue: claim, take over, resolve, with waiting time from timestamps
- Injection radar by language (Bangla / Banglish / English, as the API reports)
- Trace explorer, read-only

Empty states: `queue-empty` for HITL, `log-empty` for traces, `no-data` for charts, `releases-empty` for rollouts.

**Fix SA-6:** add a `support.manage` or `ai.hitl.manage` permission (decide in step 4 of the platform workflow) and
require it for takeover.

### E. Automations & Integrations — `/super-admin/automations`

Existing routes:
- `GET /platform/n8n` (`n8n.read`)
- `GET/POST /platform/automations` (`automation.read`; actions include `dlq.retry` / `dlq.resolve`)
- `GET /platform/operations`

**Sections:**
- n8n instances: `infrastructure-empty` when there are none; `disconnected` when unreachable.
- Workflow fleet with pause/resume per workflow (`automation.pause`, HIGH).
- DLQ console: list, inspect sanitized payload, retry one (MEDIUM), retry all (`dlq.retry_all`, HIGH), resolve.
- Provider rails table from `overview.provider_health`, including SIMULATED.

### F. Safety & Releases — `/super-admin/safety`

**Kill switches:** existing `GET/POST /platform/safety/kill-switch`.
- Scopes GLOBAL / TENANT / CHANNEL / WORKFLOW / PROVIDER are read from the API response.
- Activate and deactivate are CRITICAL; the service already requires `security.manage` + step-up. This plan adds
  approval and the impact preview.
- **Fix SA-5:** strict Zod discriminated union for `ACTIVATE` / `DEACTIVATE`.

**Feature flags:** existing `GET/POST /platform/feature-flags`.
- Global on/off, allow-list, deterministic % rollout.
- Each save shows a diff of old and new; Undo restores the previous flag body (MEDIUM, `inverse`).

**Incidents:** existing `GET/POST/PATCH /platform/incidents`.
- Declare, update status, timeline. Uses `log-empty` when there are none.

**Maintenance windows and announcements:** new in Phase J (SA-8).

### G. Security — `/super-admin/security`

**Operators:** existing `GET/POST /platform/users`.
- List with role, MFA status, last sign-in (if the record has it; otherwise the column is omitted, not faked).
- Assign role (`security.manage`, CRITICAL, approval).

**Sessions:** "Sign out everywhere" for self, via the existing `POST /auth/sessions/revoke-all`.

**Support sessions:** existing `GET/POST/DELETE /platform/support/impersonate`.
- Active sessions with a live countdown to expiry, computed from `expires_at`; one-click revoke.

**Approvals inbox (new, §5.5):**
- Pending, decided and expired requests.
- The payload diff and impact preview are shown to the approver.
- Approve/Reject require step-up.
- `queue-empty` when there is nothing pending.

**Compliance:** existing `POST /platform/compliance/export` and `/purge`.
- Export shows its SHA-256 checksum. Purge is CRITICAL (§B).

### H. Audit — `/super-admin/audit`

Existing `GET /platform/audit` (filters: `actorId` and the rest the route accepts; list them in step H-0) and
`POST /platform/audit` (export, `audit.export`).

- Filter by actor, action, target, risk and time range.
- The detail drawer shows before/after, reason, ticket and request id.
- Export to file.
- **Tamper-evident hash chain:** each entry stores `prev_hash` and `hash`. Add it only if the audit record shape
  allows it without a migration. Otherwise it is listed as a follow-up and not shown in the UI.

### I. Insights — `/super-admin/insights`

**Existing data:**
- `overview.commerce_velocity` (GMV, orders, AOV, COD %, digital %)
- `GET /platform/rto/radar` (cross-tenant RTO/COD risk by district; blinded data, no PII)
- `GET /platform/ai/observability/radar`

**New:** `GET /platform/analytics/funnel`, read-only, computed with `db.getAll*` over tenants, products and orders.
It returns the activation funnel (signup → first product → first order) and weekly signup cohorts.

`no-data` (`Plot`) whenever a series is empty.

### J. Settings, maintenance and announcements — `/super-admin/settings` and the Safety page

- **Settings:** existing `GET/POST /platform/settings` and `getSettingVersions`, driven by the **settings registry**
  (J2), not free key/value editing.
  - Forms are generated per category, with version history.
  - "Restore version" writes a new version with the old value.
  - Attention thresholds (§A), approval expiry (§5.5) and trial/lifecycle policy (C4) live here.

#### J2. Typed settings registry — `src/domains/platform/settings-registry.ts` (new)

This is how "customize the related things" works beyond plans. Each setting is declared once:

```ts
export interface SettingSpec<T> {
  key: string;                                   // "billing.trial_default_days"
  category: "BILLING" | "TRIALS" | "AI" | "SECURITY" | "RATE_LIMITS" | "NOTIFICATIONS" | "OPERATIONS" | "N8N_CLUSTER" | "STORAGE";
  schema: z.ZodType<T>;                          // bounds and shape, validated on write
  default: T;                                    // the code-constant default (non-negotiable 6)
  scopes: readonly ("GLOBAL" | "PLAN" | "TENANT")[];  // where an override is allowed
  risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  sensitive: boolean;                            // value masked in the UI and the audit log
  readBy: string | null;                         // the code that consumes it; null → "Not enforced yet", not editable
}
```

- `PlatformSettingsService.updateSetting` rejects keys that aren't in the registry and values that fail the schema.
  `PlatformSettingRecord.category` is widened to the registry categories.
- One resolver, `getEffectiveSetting(key, { tenantId?, planId? })`: tenant → plan → global → code default. The
  console shows which level each value comes from.
- **Categories and first entries:**

  | Category | Examples |
  |---|---|
  | Billing / Trials | trial default days, grace days, after-grace action, migration approval threshold |
  | AI | default model tier per plan, per-run token cap, platform-wide HITL wait threshold |
  | Rate limits | per-plan API rate limits, read by `src/lib/rate-limit.ts` |
  | Notifications | trial-ending, payment-failed and suspension message templates (variables validated against a fixed list; previewed with a real tenant's data) |
  | Security | step-up window (≤300s, rule §3.2), approval expiry |
  | Operations | attention-inbox thresholds |

- **Not platform-customizable:** merchant business config such as delivery fees, zones and COD rules. It belongs to
  the tenant (non-negotiable 6). The platform may only set **onboarding defaults for new tenants**, applied once when
  a tenant is provisioned (P2, a separate task).
- **Maintenance windows (new):** `PlatformMaintenanceService` + `GET/POST/PATCH /platform/maintenance`
  (`maintenance.read` / `maintenance.manage`) on the existing `platform_maintenance_windows` collection.
  - Scheduled start and end.
  - Active state is derived on read.
- **Announcements (new):** `PlatformAnnouncementService` + `GET/POST/PATCH /platform/announcements`
  (`announcement.create` / `announcement.update` / `announcement.publish`) on `platform_announcements`.
  - Draft → published, targeted at all tenants or a plan.
- **Merchant display** of active announcements and maintenance: a tenant read route plus a `TopBar` banner. It is a
  separate follow-up task, because it touches the merchant app.

---

## 7. Backend work summary

| Item | Type | Phase |
|---|---|---|
| `PlatformPermissionDeniedError` includes `details.permission` | edit | A |
| `privileged-actions.ts` registry + `PrivilegedActionGate`; `classifyRisk` reads the registry | new / edit | B |
| `approval.decide` permission (SUPER_ADMIN, PLATFORM_SECURITY) | edit `permissions.ts` | B |
| `platform_approval_requests` collection + `PlatformApprovalService` + 3 routes | new | B |
| `GET /platform/impact` (read-only impact preview) | new | B |
| Kill-switch route Zod body (SA-5); HITL takeover permission (SA-6) | fix | B |
| `GET /platform/attention` (computed inbox) | new | C (Control Tower lands after governance) |
| `?tenant_id=` filters where missing; tenant archive route if missing; override `expires_at` | edit | D |
| `entitlement-catalog.ts`; plan `features` validated against it; `resolveLimit`: add-ons, override `expires_at`, TRIAL/grace (SA-12, SA-13) | new / edit | G |
| Plan/version fields (visibility, status, monthly+annual price, trial days, setup fee); draft→publish; fixes SA-9, SA-10, SA-11 | edit types + `platform-subscription.service.ts` + `platform-analytics.service.ts` | G |
| Routes: `PATCH /platform/plans/[id]`, `POST /platform/plans/[id]/versions` (draft), `POST /platform/plans/versions/[id]/publish` and `/retire`, `GET /platform/plans/impact`, `POST /platform/plans/migrate` | new | G |
| `platform_addons`, `tenant_addons` collections + `PlatformAddonService` + `GET/POST /platform/addons`, `POST /platform/tenants/[id]/addons` | new | G |
| `POST /platform/tenants/[id]/trial` (extend trial) | new | G |
| `settings-registry.ts` + `getEffectiveSetting`; `updateSetting` validates against it | new / edit | I |
| `GET /platform/analytics/funnel` | new | H |
| Maintenance + announcement services and routes | new | I |

Every new route:
- follows the canonical pattern in AGENTS.md §4: `extractPlatformContext`, `assertCan`, a strict Zod body, `withStore`
- uses `apiSuccess` / `apiError`
- writes an audit entry for mutations

New collections are platform-scope JSONB documents. Run `npm run test:pg` after adding them. No SQL migration is
needed unless a collection is promoted into `CORE_TABLES`; this plan promotes none.

---

## 8. Phases (each phase is one reviewable PR)

| Phase | Scope | Exit criteria |
|---|---|---|
| **A. Foundation** | Preconditions (§1); `Dock` extraction + merchant pixel check; `Shell.module.css`; `(console)` layout, `PlatformNav`, `PlatformTopBar`, `PlatformCommandPalette`; `use-platform-resource` + `ResourceView`; `HairlineFigure` + `EmptyState.illustration`; move `platform-client.ts` to `_lib/`; fix SA-1…SA-4; Control Tower KPI row + health + recent actions only | type-check 0; `npm test` green; new console suite green; merchant dock unchanged; every Control Tower value traces to an API field |
| **B. Governance primitives** | Registry, gate, approvals (service, routes, UI inbox), impact preview, step-up hook, `PrivilegedActionDialog`, SA-5, SA-6 | Approval invariants tested; `security-reviewer` clean; `/platform-security-review` 20 points recorded |
| **C. Control Tower inbox** | `GET /platform/attention` + inbox card | Seeded-state tests for each item type; GET write-free |
| **D. Tenants** | List + 360° view + actions | §B acceptance |
| **E. Safety & Releases + Security** | Kill switches, flags, incidents; operators, support sessions, compliance | Kill switch requires step-up + approval end to end; impersonation countdown matches `expires_at` |
| **F. AI Governance** | §D | Budget PATCH requires step-up; HITL takeover requires the new permission |
| **G1. Automations** | §E | DLQ retry audited |
| **G2. Customization Studio** | §C1–C5: entitlement catalog, plan builder (draft/publish/retire), add-ons (complimentary), trials and the Commercial tab, plan migration with impact preview; fixes SA-9…SA-13 | Changing a plan picks the latest version; annual MRR is correct; TRIAL tenants get plan limits; "Not enforced" keys can't be set on a plan; a lowered limit's impact counts match a seeded fixture; an expired override or add-on stops applying with no write |
| **H. Audit + Insights** | §H, §I, funnel endpoint | Funnel numbers match a hand-computed seeded fixture |
| **I. Settings, maintenance, announcements** | §J (console side) | Maintenance window active state derived on read |

---

## 9. Testing and verification

**New suite: `tests/super-admin-console-tests.ts`** (added to the `npm test` script).
- **Static scans** over `src/app/super-admin/**/*.tsx` and `src/components/motion/**`:
  - no hex colors
  - no `|| "SUPER_ADMIN"` or similar identity fallbacks
  - no metric fallbacks such as `?? 0}`, `: "100%"`, `"৳0"`
  - every `(console)` page renders through `ResourceView`
  - `HairlineFigure` is never given numeric props
- **Dock map:** every platform dock item has a permission in `platform-module-access.ts`, and that permission exists
  in `PLATFORM_PERMISSIONS`.
- **Approvals:**
  - requester ≠ approver
  - the approver needs `approval.decide` + the action permission + step-up
  - a payload hash mismatch is refused
  - an expired request is refused (derived, not stored)
  - single use
  - every transition is audited
  - a refused attempt is persisted via `keepEvenIfRequestFails`
- **Gate:**
  - HIGH without step-up → `StepUpRequiredError`
  - CRITICAL without approval → `ApprovalRequiredError`
  - reason < 10 characters → validation error
- **Attention / impact / funnel:** correct items and counts from seeded state; empty when healthy.
- **Customization:**
  - A plan write with an unknown or not-enforced key is refused; one outside the catalog bounds is refused.
  - Published versions can't be edited.
  - `resolveLimit` precedence follows override (unexpired) → plan + add-ons → default, for ACTIVE, TRIAL and
    in-grace PAST_DUE.
  - `assertWithinLimit` uses the add-on-raised limit.
  - Migration needs approval above the threshold.
  - A settings write with an unregistered key or a schema-invalid value is refused.
  - Extend `rbac-matrix-tests.ts` for the new permissions.

**Existing suites to run:**
- `super-admin-tests.ts`
- `security-regression-tests.ts`
- `rbac-matrix-tests.ts`
- `phase2-readonly-tests.ts` (confirm it picks up the new GET routes; extend its list if it enumerates by hand)
- `phase3-truthfulness-tests.ts`
- `npm run test:pg`
- `npm run type-check`

**Live checks:**
- `BASE_URL=http://localhost:3000 node scripts/smoke-security.mjs` against a server without `DEV_AUTH_BYPASS`.
- In the browser, for each page:
  - **Loading** (throttled network).
  - **Empty** (fresh store): Hairline figure visible, plate matches the card.
  - **Error** (API stopped): request id + Retry.
  - **Forbidden** (sign in as `PLATFORM_ANALYST`): action controls hidden, `PermissionDenied` names the permission.
  - **Unauthorized** (expired cookie): redirect to login.
  - **Reduced motion** (emulated): figures rest.
  - Mobile width.
- Use a throwaway operator in a separate worktree. The in-app browser can change saved passwords (see project
  memory).

**Gates before calling a phase done:** the `security-reviewer` agent on phases B, D, E and F; the `done-verifier`
agent; STATUS.md rows updated.

---

## 10. Documentation updates

- `.agent/STATUS.md`: Platform control plane row (console modules, two-person approval), one history row per phase.
- `.agent/DECISIONS.md`: **ADR-116, Super Admin Console and Two-Person Approval.** Covers the shared dock, the
  `(console)` route group, the privileged-action registry, the approval binding, and Hairline as illustration only.
  Use the next free number after the merge is resolved.
- `.agent/API_CONTRACTS.md`: approvals, impact, attention, funnel, maintenance, announcements.
- `.agent/DATA_MODEL.md`: `platform_approval_requests`; fields added to maintenance and announcements.
- `.agent/rules/platform-ui.md`: dock section (§3.2), Hairline usage table (§4.3), no count-up animation.
- Mark `docs/super-admin-saas-platform-evolution-plan.md` and `docs/super-admin-ai-gateway-and-iam-forensics-plan.md`
  as superseded (UI sections) at their top.

---

## 11. Open decisions (defaults chosen; change before Phase A if needed)

| ID | Decision | Default in this plan |
|---|---|---|
| D1 | Canvas color | Same as merchant (`--color-bg-base`); dark cards for hero and command zones |
| D2 | Dock | The merchant `Dock` component, vertical on the left, 9 modules + search, settings, log out |
| D3 | Single-operator installations | CRITICAL actions stay blocked until a second operator with `approval.decide` exists; no break-glass |
| D4 | HIGH approvals | Only `tenant.suspend` for tenants older than 30 days (privileged-actions.md §1); other HIGH actions need step-up only |
| D5 | Billing tab scope | Plans, subscriptions and MRR now; invoices and wallets only after the billing engine routes exist |
| D6 | Data refresh | Polling (60s on Control Tower only, while visible); no websockets |
| D7 | Limits for TRIAL / PAST_DUE tenants (SA-12) | TRIAL uses its plan version's limits; PAST_DUE keeps them for `billing.past_due_grace_days`, then falls back to defaults until billing jobs enforce `after_grace_action` |
| D8 | Customizing a key that isn't enforced | Not allowed; shown as "Not enforced yet". Each new enforced limit is a small developer task |
| D9 | Lowering a limit below current usage | Existing data kept, new additions blocked; never deletes or hides tenant data |
| D10 | Add-ons before the billing engine | COMPLIMENTARY grants only (operator, with reason); PURCHASED later |

---

## 12. File manifest

**New:**
```
src/components/navigation/Dock.tsx
src/components/navigation/Shell.module.css
src/components/motion/HairlineFigure.tsx
src/components/motion/HairlineFigure.module.css
src/app/super-admin/(console)/layout.tsx
src/app/super-admin/(console)/{page,tenants/page,tenants/[id]/page,billing/page,ai/page,automations/page,safety/page,security/page,audit/page,insights/page,settings/page}.tsx  (+ sibling *.module.css)
src/app/super-admin/_components/{PlatformNav,PlatformTopBar,PlatformCommandPalette,ResourceView,PrivilegedActionDialog,ApprovalsInbox,...}.tsx
src/app/super-admin/_lib/{use-platform-resource,use-step-up,platform-module-access,format}.ts
src/domains/platform/privileged-actions.ts
src/domains/platform/entitlement-catalog.ts
src/domains/platform/settings-registry.ts
src/domains/platform/services/{platform-approval,platform-maintenance,platform-announcement,platform-addon}.service.ts
src/app/api/v1/platform/{approvals,approvals/[id]/decision,approvals/[id]/cancel,impact,attention,analytics/funnel,maintenance,announcements}/route.ts
src/app/api/v1/platform/{plans/[id],plans/[id]/versions,plans/versions/[id]/publish,plans/versions/[id]/retire,plans/impact,plans/migrate,addons,tenants/[id]/addons,tenants/[id]/trial}/route.ts
src/app/super-admin/_components/{PlanEditor,EntitlementMatrix,EffectiveValueInspector,SettingsForm}.tsx
tests/super-admin-console-tests.ts
```

**Edited:**
```
src/components/navigation/FloatingNav.tsx        → wraps Dock (merchant output unchanged)
src/app/(dashboard)/layout.tsx                    → uses Shell.module.css (no visual change)
src/components/ui/States/States.tsx               → EmptyState.illustration
src/styles/tokens.css                             → only if a motion token is needed
src/app/super-admin/layout.tsx, login/page.tsx
src/app/super-admin/page.tsx                      → moved to (console)/page.tsx
src/app/super-admin/platform-client.ts            → moved to _lib/
src/lib/permissions.ts, src/lib/errors.ts, src/lib/safety-gate.ts
src/types/platform.ts                             → plan/version/override fields (all optional, backward compatible)
src/domains/platform/services/{platform-authorization,platform-subscription,platform-entitlement,platform-analytics,platform-settings}.service.ts
src/app/api/v1/platform/safety/kill-switch/route.ts, ai/hitl/takeover/route.ts
src/infrastructure/db/index.ts, src/infrastructure/store/store-schema.ts
package.json (test script), .agent/* docs listed in §10
```

---

## 13. Implementation notes (2026-10-12)

Built as planned, with these differences:

- **Phases were done in dependency order**, not plan order: the entitlement catalog and settings registry came first because the attention inbox, Tenant 360 and migration impact read them.
- **Approval targets are derived on the server** from the action and its payload; the approvals API takes only `{action_key, payload, reason, ticket_ref}`. Tenant-targeted payloads use the key `tenant`, migrations `tenants`.
- **Security review (2026-10-12)** found 1 HIGH and 7 MEDIUM policy bypasses; all fixed and tested: archive also needs two operators for tenants older than 30 days; archived or purge-scheduled tenants can't be suspended; role changes need the caller to hold every permission of both the old and the new role, and the operator being changed can't approve it; migration batches and one-by-one plan changes off a version count toward the threshold for 24 h; settings marked HIGH/CRITICAL (approval and billing policy) need two operators; overrides, AI budget and HITL takeover go through the gate (ticket/reason enforced server-side); the approver is re-checked when an approval is used.
- **Feature flags**: only keys in `feature-flag-registry.ts` (read by code) can be set.
- **Purge** schedules a 14-day tombstone and says nothing was deleted; no deletion job exists.
- **Merchant notices** (announcements, maintenance) were built rather than deferred, so publishing isn't a fake control.

### What remains

1. Step-up tokens are reusable for 5 minutes and not bound to an action (pre-existing; rule §3.2 wants CRITICAL actions to consume them).
2. Concurrent execution of one approval relies on the store's version-checked writes; not tested under `COMMERCEOS_TEST_PG=1` with parallel requests.
3. Approval requests are visible to every `platform.read` holder (ids, reasons, tickets only).
4. `entitlement.default_update` is declared but has no service or route; global defaults are read-only in the console.
5. Billing-engine features (coupons, invoices, overage, purchased add-ons, VAT) wait for `docs/saas-monetization-billing-plan.md`.
6. Merchant upgrade page reading public plans (C7) is not built.
7. Merchant dock after the `Dock` extraction was checked on a live server (renders as before); no pixel diff was taken.
