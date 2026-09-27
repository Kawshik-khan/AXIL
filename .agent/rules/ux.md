---
trigger: glob
description: Density, keyboard access, optimistic UI limits
globs: src/app/**/*.tsx, src/components/**/*
---

# User Experience (UX) & Control Plane Rules

1. **Information Density & Composition**:
   - Provide high information density suitable for operations teams while maintaining clean visual breathing room.
   - Avoid oversized marketing hero sections inside the operational control plane.

2. **Accessible Keyboard Navigation**:
   - The global command palette must open on `Cmd + K` (or `Ctrl + K`) from any screen.
   - All interactive controls (buttons, inputs, dropdown items) must support keyboard navigation and visible focus rings (`var(--color-lime-primary)`).

3. **Optimistic UI Constraints**:
   - Optimistic UI is permitted ONLY for low-risk, reversible client interactions (e.g. marking a message read, changing a local filter).
   - Never use optimistic UI for payments, order cancellations, refunds, or courier booking where external API confirmation is required.
