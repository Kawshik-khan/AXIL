## 2024-10-14 - Debounce Frontend Search Queries
**Learning:** Frequent React state updates attached to network requests (like `onChange` directly triggering a `fetch`) create significant frontend and backend load. In CommerceOS `ProductSearchModal`, a `useEffect` watched `query` directly.
**Action:** Always implement a `debouncedQuery` state with a 300ms `setTimeout` in a separate `useEffect` to batch fast-typing updates before triggering expensive API calls.
