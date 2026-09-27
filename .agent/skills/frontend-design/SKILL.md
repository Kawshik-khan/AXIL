---
name: frontend-design
description: Build or restyle CommerceOS UI — Bento grid pages, floating dock navigation, design tokens, CSS Modules, the six UX states, and wiring pages to real API routes. Use for work in src/app/**/*.tsx, src/components/**, or src/styles/**.
---

# Frontend Design

Rules: `.agent/rules/frontend.md`, `.agent/rules/ux.md`, `.agent/UX_RULES.md`; control plane: `.agent/rules/platform-ui.md`.
Visual language (summary): `.agent/DESIGN_SYSTEM.md`. **Values:** `src/styles/tokens.css` only.

## Building blocks that already exist
| Need | Use |
|---|---|
| Grid + cards | `src/components/bento/BentoGrid.tsx`, `BentoCard.tsx`, `Bento.module.css` |
| Navigation | `src/components/navigation/FloatingNav.tsx`, `TopBar.tsx`, `CommandPalette.tsx` |
| Buttons, inputs, badges, modals | `src/components/ui/{Button,Input,Badge,Modal}` |
| Loading / empty / error / no-permission | `src/components/ui/States` |
| Placeholder for unbuilt modules | `src/components/bento/ModulePlaceholder.tsx` |

## Page recipe
1. Page in `src/app/(dashboard)/<area>/page.tsx`; styles in a sibling `*.module.css`.
2. Grid: `grid-template-columns: repeat(12, 1fr); gap: 16px;` — KPI cards span 3–4, charts/tables 8–12; collapse to 6 cols < 1024px, 1 col < 640px.
3. Style only with variables: `background: var(--color-surface-pure); border-radius: var(--radius-card); color: var(--color-text-primary);`. Missing token → add to `tokens.css`.
4. AI elements: `✦` prefix, `var(--color-lime-glow)` edge, metadata pills (agent, tools, sources, confidence) — no raw reasoning.
5. Data: fetch from an existing `/api/v1/**` route. Confirm it exists: `ls src/app/api/v1/<resource>`; check the handler's expected body.
6. Handle all six states; errors show `request_id` + Retry; 401 → re-auth without losing input; 403 → name the missing permission.
7. No hard-coded numbers or demo arrays; empty data → empty state with one CTA.

## Existing debt (don't make it worse)
~1,100 raw hex literals in `.tsx`; pages up to 2.4k lines (`super-admin/page.tsx`, `(dashboard)/page.tsx`, `agents/page.tsx`). When you touch one, extract the section you change into a component and convert its colors to tokens.

## Verify
`npm run type-check`; run `npm run dev` and open the page; exercise empty and error states (e.g. new tenant, stopped API).
