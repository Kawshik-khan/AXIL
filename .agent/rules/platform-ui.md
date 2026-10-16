---
trigger: glob
description: Super-admin dark-variant UI, confirmation modals, no fake metrics
globs: src/app/super-admin/**/*
---

# Platform UI Design System & Control Plane UX Rules

## 1. Aesthetic Identity & Design System Tokens
The Super Admin Platform Control Plane represents the flagship command center of CommerceOS. It must feel exceptionally premium, dense, modern, and purposeful — never a generic template or amateurish CRUD interface:

The control plane is the **dark variant** of the one design system. Values come from `src/styles/tokens.css` — never restate or hard-code them:

| Role | Token |
|---|---|
| Canvas | `--color-bg-base` |
| Panel / card surface | `--color-surface-dark`, `--color-dark-card`, `--color-dark-elevated` |
| Accent | `--color-lime-primary` (hover `--color-lime-hover`) |
| Borders on dark | `--color-border-dark` |
| Overlays / glass | `--glass-bg-dark`, `--glass-border-dark`, `--glass-backdrop-blur` |
| Text on dark | `--color-text-inverse`, `--color-text-dark-muted` |
| Radii | `--radius-card` (cards), `--radius-control` (buttons/inputs), `--radius-dock` (dock/modals) |
| Font | `--font-family-base` |

---

## 2. Layout Structure: Bento Grid & Floating Command Dock
1. **12-Column Responsive Bento Grid**:
   - High information density with clear visual hierarchy.
   - Core operational signals (fleet status, MRR, queue health) placed in hero cards at the top.
   - Modular widgets designed with clean borders, micro-charts, and status indicators.

2. **Floating Navigation & Command Dock** (ADR-116):
   - The console uses the merchant dock component (`src/components/navigation/Dock.tsx`) with the console modules in `src/app/super-admin/_lib/console-modules.tsx`; access per module comes from `_lib/platform-module-access.ts`. Same left column on desktop and bottom bar on mobile as the merchant app.
   - Global Command Palette (`Cmd + K` / `Ctrl + K`) jumps to modules and searches tenants through the tenants API.

3. **6 Canonical UX States Mandatory**:
   Every platform view and card must gracefully handle all six states:
   - **Loading**: Skeleton pulse matching charcoal/slate card geometry (no jarring white spinners).
   - **Success**: Richly populated Bento card with live data and visual badges.
   - **Empty**: Informative card with clear context (`"No active incidents reported"`, `"No pending DLQ items"`).
   - **Error**: Structured error banner detailing error code, `request_id`, and retry action.
   - **Unauthorized**: Redirect to platform session login with MFA prompt.
   - **No Permission**: Clean card explaining the missing platform permission without exposing sensitive internals.

---

### 2.4 Motion and illustrations
- Hairline figures (`src/components/motion/HairlineFigure.tsx`) are illustrations for empty, all-clear, disconnected and sign-in states only. They never carry data; their plate colour must match the surface (token-mapped in `HairlineFigure.module.css`).
- Loading uses skeletons, not figures. No count-up animation on numbers.

## 3. High-Risk Action Confirmation Modals
All privileged actions use `src/app/super-admin/_components/PrivilegedActionDialog.tsx`, which asks for exactly what the action declares in `src/domains/platform/privileged-actions.ts`.

Administrative mutations (e.g. suspending a tenant, triggering a kill switch, purging data) carry severe consequences. The UI must enforce disciplined confirmation patterns:

1. **Impact Summary**: The modal must explicitly detail:
   - Target resource and affected tenant(s)
   - Scope of downtime or service disruption
   - Immediate consequences to running jobs or store customers
2. **Mandatory Justification Input**: per `rules/privileged-actions.md` §2.
3. **Typed Match Confirmation for `CRITICAL` Tier**:
   - For `CRITICAL` risk operations (e.g. Tenant Purge, Global Kill Switch), the operator must type the exact entity name or slug to confirm:
     *`Type "CONFIRM KILL SWITCH" to proceed.`*
4. **Step-Up MFA Challenge**: Embedded TOTP/WebAuthn prompt inside the confirmation flow.

---

## 4. Truth-in-Data Invariant (No Fake Metrics)
- **Zero Faux Figures**: All metrics, graphs, counts, and financial values must originate from genuine backend data queries or operational telemetry.
- **NEVER** hardcode fictional figures (e.g. `99.999% uptime`, `৳4,500,000 MRR`) to make the interface look full.
- If data is unavailable, render `"No data available"` or `"Collecting telemetry"`.
