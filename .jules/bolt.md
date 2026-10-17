## 2026-10-11 - React Rendering Optimization
**Learning:** Found a component (`UnifiedInbox`) that performed multiple `Array.prototype.filter` operations on the same array during render, creating an O(5N) operation with intermediate array allocations.
**Action:** Replaced multiple filters with a single `Array.prototype.reduce` pass to compute all counts simultaneously and wrapped it in `useMemo` to prevent recalculation on every render.

## 2026-10-17 - React Render Loop Optimization
**Learning:** The UI contained many inline array filters (e.g. \`providers.filter(...).length\`) that executed multiple O(N) passes within the render cycle.
**Action:** Used a single \`useMemo\` computation pass to determine all array segment sizes simultaneously instead of inline filtering, reducing CPU overhead during render to O(N) from O(K*N).
