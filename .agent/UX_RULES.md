# CommerceOS User Experience (UX) Rules & Human Control Plane

## 1. The 6 Mandatory Page States

Every major view, Bento card, and data table must gracefully handle all 6 UI states:
1. **Loading State**: Elegant pulse skeletons matching the exact geometry of the loaded content. Avoid generic full-page spinner overlays.
2. **Success / Active State**: Clean, high-density Bento representation with clear visual hierarchy.
3. **Empty State**: Contextual illustration/icon, clear explanation, and a single primary call-to-action button (e.g. *"No products added yet. Click to import your catalog"*).
4. **Error State**: Friendly error explanation, error reference ID (`request_id`), and an instant "Retry" action. Never expose stack traces or raw JSON errors.
5. **Unauthorized State**: Seamless prompt to re-authenticate without losing current filter/input context.
6. **No Permission State**: Clear notification of required role permissions (e.g. *"Requires Finance Manager permission to approve refunds"*).

---

## 2. Interaction Design & Micro-Animations

- **Button Clicks**: Subtle active scale transform (`transform: scale(0.98); transition: transform 0.1s ease;`).
- **Hover Transitions**: Smooth 150ms ease-out transitions for card elevations and border highlights.
- **Floating Dock Navigation**:
  - Highlights active route with Lime pill indicator (`var(--color-lime-primary)`).
  - Smooth expansion from icon-only to icon+label on hover (desktop).
  - Bottom docked on mobile viewports ($< 768\text{px}$) with haptic-conscious touch targets ($\ge 48\text{px}$).

---

## 3. Global Top Bar & Command Palette (`Cmd + K`)

The Top Bar provides immediate global awareness and keyboard-first accessibility:
1. **Left**: Current Tenant selector & breadcrumb context.
2. **Center**: Global Command Search input (`Cmd + K`):
   - Search across Products, Orders, Customers, Conversations.
   - Natural language commands: *"Show low stock items"*, *"Find delayed Steadfast parcels"*, *"Today's sales report"*.
3. **Right**:
   - `✦ AI Status Indicator` (Green dot: Active / Idle; Yellow pulse: Reasoning; Orange: Rate-limited).
   - Pending Approvals Bell (with badge count for human-in-the-loop actions).
   - User Profile avatar and menu.

---

## 4. Mobile & Tablet Adaptations

- On viewports under 1024px, the 12-column Bento collapses gracefully to 6 columns.
- On viewports under 640px, cards stack into single columns (12/12 span).
- Large data tables transform into compact swipeable mobile cards with key metrics visible.
- Floating Dock shifts from the left edge to fixed bottom center with backdrop blur.
