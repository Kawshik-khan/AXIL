## 2026-10-11 - React Rendering Optimization
**Learning:** Found a component (`UnifiedInbox`) that performed multiple `Array.prototype.filter` operations on the same array during render, creating an O(5N) operation with intermediate array allocations.
**Action:** Replaced multiple filters with a single `Array.prototype.reduce` pass to compute all counts simultaneously and wrapped it in `useMemo` to prevent recalculation on every render.
## 2026-10-21 - Database Query Optimization
**Learning:** Found an O(N²) array search in `getConversations` where an O(N) `findCustomerById` lookup was repeatedly called within a loop across conversations.
**Action:** Replaced the repeated array searches with a pre-fetched hash map (`customersById`), dropping the time complexity to O(N+M) and reusing the cache for pagination loops.
