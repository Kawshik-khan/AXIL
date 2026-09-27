# CommerceOS Frontend Design System & Tokens

CommerceOS UI embodies a state-of-the-art visual standard:
$$\text{PREMIUM} + \text{BENTO GRID} + \text{SUBTLE GLASSMORPHISM} + \text{MINIMAL ENTERPRISE SAAS} + \text{LIME ACCENT} + \text{CHARCOAL} + \text{OFF-WHITE}$$

---

## 1. Non-Negotiable Layout Principles

1. **NO TRADITIONAL FIXED LEFT SIDEBAR**:
   - CommerceOS uses a **Floating Navigation Dock**.
   - Desktop: Vertical, detached, rounded floating dock (~68px wide), vertically centered on the left viewport margin. Floats gracefully above the page content. May expand to reveal labels on hover.
   - Mobile: Transforms into a floating horizontal bottom navigation dock.
2. **12-Column Bento Grid**:
   - Layouts are structured as clean, modular Bento grids with 12–16px gaps.
   - Cards span 3, 4, 6, 8, or 12 columns based on compositional hierarchy.

---

## 2. Tokens — canonical source: `src/styles/tokens.css`

Do not copy values into docs or components; reference the variables. Key groups:

| Group | Variables |
|---|---|
| Brand | `--color-lime-primary` (#C7F900), `--color-lime-bright`, `--color-lime-soft`, `--color-lime-glow`, `--color-lime-hover` |
| Surfaces (light) | `--color-bg-base` (off-white), `--color-surface-pure`, `--color-surface-soft` |
| Surfaces (dark / control plane) | `--color-surface-dark` (charcoal #242529), `--color-dark-elevated`, `--color-dark-card` |
| Text | `--color-text-primary`, `--color-text-secondary`, `--color-text-muted`, `--color-text-inverse`, `--color-text-dark-muted` |
| Borders | `--color-border-subtle`, `--color-border-medium`, `--color-border-dark`, `--color-border-active` |
| Semantic | `--color-success|warning|danger|info` and `*-bg` variants |
| Glass | `--glass-bg`, `--glass-bg-dark`, `--glass-border`, `--glass-border-dark`, `--glass-backdrop-blur`, `--glass-shadow*` |
| Type | `--font-family-base`, `--font-size-{display,title,section,card,body,meta}` + matching `--line-height-*` |
| Radii | `--radius-sm` (chips), `--radius-control` (inputs/buttons), `--radius-card`, `--radius-lg`, `--radius-dock` (dock/modals), `--radius-pill` |
| Spacing | `--space-*` |

Light theme is the merchant dashboard; the dark variant (charcoal surfaces) is used for the super-admin control plane and AI/overlay panels. Both use the same tokens.

---

## 3. AI Visual Marker & Transparency UI

- **Marker**: Every AI element is prefixed by the `✦` symbol (e.g. `✦ AI Insight`, `✦ AI Agent Recommendation`).
- **Glow & Shimmer**: AI cards feature a subtle `var(--color-lime-glow)` perimeter highlight.
- **Transparency Metadata**: Instead of raw chain-of-thought, AI panels display structured pills:
  - `Agent: Sales Agent`
  - `Sources: Catalog, Policy`
  - `Tools: product.search, inventory.check`
  - `Status: Verified (0.94 confidence)`
