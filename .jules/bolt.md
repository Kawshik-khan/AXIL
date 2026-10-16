## 2024-05-24 - Missing debouncing on frequent API calls
**Learning:** Found multiple instances where search inputs hit an API on every keystroke, which could lead to excessive server load and unhandled race conditions on responses.
**Action:** Use a `useDebounce` hook for all input-driven search API queries to delay fetching until the user has stopped typing.
