## 2026-10-07 - Optimize React rendering in social inbox

**Learning:** Multiple array traversals `.filter()` during component render loops can silently degrade performance for large datasets if not batched or memoized.
**Action:** Use a single-pass `Array.prototype.reduce` block inside a `useMemo` hook to calculate counts or multiple derived values simultaneously, cutting down O(N * M) loops to O(N).
