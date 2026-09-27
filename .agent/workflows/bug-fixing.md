---
description: Fix a bug or audit finding — reproduce, failing regression test, minimal fix, verify, update STATUS
---

# Bug Fixing & Defect Resolution Workflow

Follow this procedure when triaging, diagnosing, and resolving defects in CommerceOS:

0. **Audit findings**: if the bug has an ID in `AUDIT_REPORT_2026-09-27.md`, follow its `FX-nn` item in `FIX_IMPLEMENTATION_PLAN.md` (steps, tests, done-when) and re-grep line numbers before editing.

1. **Reproduction & Telemetry Ingestion**:
   - Extract the failing `request_id`, `trace_id`, or `tenant_id` from logs.
   - Recreate the exact failure conditions in an isolated local test environment.

2. **Write a Failing Regression Test**:
   - Before modifying any production code, write a unit or integration test that reliably reproduces the defect.
   - The test must fail with the reported symptom.

3. **Isolate Root Cause & Identify Boundaries**:
   - Determine whether the defect stems from domain calculation, database concurrency, API serialization, agent tool execution, or frontend rendering.

4. **Apply the Minimal Safe Fix**:
   - Make the smallest surgical change necessary to resolve the root cause without side-effects.
   - Avoid speculative refactoring in a bug fix commit.

5. **Verify Regression Test Passes**:
   - Run the regression test and verify it now passes. Run the entire test suite to ensure no collateral breaks.

6. **Audit Downstream Effects**:
   - Check if cached data or stored records in the database require remediation.
   - Document the resolution and update test suites.
   - Update `STATUS.md` (§4 open findings, §5 change log) when an audit finding is closed.
