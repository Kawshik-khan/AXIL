---
trigger: glob
description: UI structure, tokens, Bento grid, states, wiring
globs: src/app/**/*.tsx, src/components/**/*, src/styles/**/*
---

# Frontend Development Rules

1. **Navigation**: no full-height fixed left sidebar. Use the floating dock (`src/components/navigation/FloatingNav.tsx`), top bar, and `Cmd/Ctrl + K` command palette that already exist — extend them, don't fork them.

2. **Styling**:
   - Vanilla CSS / CSS Modules only (no Tailwind unless the user asks).
   - Colors, radii, spacing, fonts come from CSS variables in `src/styles/tokens.css`. No raw hex/rgba in `.tsx` or new CSS; if a token is missing, add it to `tokens.css` first.
   - Prefer `*.module.css` over inline `style={{…}}` for anything beyond one-off layout.

3. **Layout**: 12-column Bento grid (`src/components/bento/BentoGrid.tsx`, `BentoCard.tsx`), 16px gap. Glassmorphism only on floating nav, overlays, dropdowns, and AI panels.

4. **States**: every data view handles Loading, Success, Empty, Error (with `request_id` + retry), Unauthorized, No Permission. Reuse `src/components/ui/States`.

5. **Wiring**: every `fetch` targets an existing route under `src/app/api/v1/**` with the correct method and body shape. Verify the route exists before writing the call (audit M1). Don't show a success alert unless the response says success.

6. **No fake data**: no hard-coded metrics or demo arrays in dashboard pages; render the empty state.

7. **File size**: split pages over ~500 lines into components under `src/components/<area>/`. Don't grow the existing 1.8k–2.4k-line pages further.
