## 2026-10-08 - [Parallelize JSON Parsing]
**Learning:** Found multiple files where multiple JSON objects where being parsed sequentially using `await res.json()`. While using `Promise.all` on the `fetch` calls gets network concurrency, waiting on `.json()` sequentially forces the thread to block on each stream read and JSON parse one by one. Using `await Promise.all([res1.json(), res2.json()])` allows the microtasks for stream reading and parsing to interleave, making it slightly faster.
**Action:** Use `Promise.all` to parse JSON responses from multiple parallel network requests.
