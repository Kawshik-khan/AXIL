## 2024-12-09 - UnifiedInbox Array Iteration Optimization
**Learning:** React components dealing with large arrays (like conversations) often perform redundant iterations (e.g. multiple `.filter()` calls for different statuses). This causes N x M iterations on every render, blocking the main thread.
**Action:** Replace multiple filter passes with a single pass in a `React.useMemo` block when computing multiple derived stats from a single array.
