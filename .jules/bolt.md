## 2026-10-11 - React Rendering Optimization
**Learning:** Found a component (`UnifiedInbox`) that performed multiple `Array.prototype.filter` operations on the same array during render, creating an O(5N) operation with intermediate array allocations.
**Action:** Replaced multiple filters with a single `Array.prototype.reduce` pass to compute all counts simultaneously and wrapped it in `useMemo` to prevent recalculation on every render.

## 2026-10-18 - React Navigation Re-render Optimization
**Learning:** In highly interactive components like `CommandPalette`, local state changes that happen frequently (like `selectedIndex` when pressing arrow keys) trigger full re-renders. When static arrays or expensive filtering calculations are recreated/executed on every render, it causes noticeable UI input lag, especially in search panels where users type or navigate rapidly.
**Action:** Always wrap static command lists and their filtered derivations in `useMemo` so that local navigation state (e.g. keyboard navigation) doesn't redundantly recompute search filters.
