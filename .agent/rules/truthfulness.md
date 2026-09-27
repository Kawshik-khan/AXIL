---
trigger: always_on
description: Honest status reporting, no simulated success, no fabricated data
---

# Truthfulness & Honest Reporting Rules

Why this rule exists: earlier project docs claimed "Phase 12 complete, 260/260 tests passing" while the system had
six working auth bypasses and most integrations were stubs reporting success (audit I1, I2, H7, H9, H14).

1. **Status claims**:
   - Only `.agent/STATUS.md` states what works. Use its vocabulary: LIVE, PARTIAL, SIMULATED, STATIC, BROKEN, TARGET.
   - "Tests pass" is not "feature works". A feature is LIVE only when traced end-to-end (UI → route → service → store) and covered by a test that exercises the real path.
   - Never mark a roadmap phase or a doc section "complete" or "production-grade" without evidence you can cite (command + output, or file:line).

2. **Simulated effects**:
   - Code that does not perform the real external effect (send message, book courier, verify payment, call LLM, embed text) must return an explicit `SIMULATED` / `NOT_SENT` status and must not show a success toast or write a "sent/paid/delivered" state.
   - Mock providers must be named `mock-*` / `*Simulated*` and selected only by explicit config — never as a silent fallback.

3. **Data**:
   - No hard-coded baselines, `Math.random()` metrics, or demo numbers in production paths. Empty data → empty state ("No data yet").
   - Don't silently truncate (e.g. default `limit: 50`) in aggregates; if you cap, say so in the response `meta`.

4. **Reporting your own work**:
   - Final messages list: what changed, the verification commands you ran and their results, what you did not verify, and anything left simulated or stubbed.
   - If a check fails or you skipped it, say so. Never round "mostly works" up to "done".

5. **Documenting gaps**:
   - Mark unimplemented parts as `STATUS: NOT IMPLEMENTED` or `TARGET` rather than writing plausible prose. An honest gap marker is always preferred over invented detail.
