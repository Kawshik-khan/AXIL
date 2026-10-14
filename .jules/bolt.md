
## 2023-10-13 - Double Fetch Anti-Pattern in React Search Forms
**Learning:** Manual API calls coupled with state resets (like `setPage(0)`) in React event handlers trigger double-fetching when `useEffect` hooks are also watching those state variables.
**Action:** Let `useEffect` handle all data fetching and sync it to a debounced search state, eliminating manual fetch calls from event handlers entirely.
