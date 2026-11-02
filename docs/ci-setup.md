# CI/CD setup (production readiness R5)

Workflows in `.github/workflows/`: `ci.yml` (type-check, `npm test`, `npm run test:pg`, `npm run test:eval`, offline RAG replay + report artifact, build, migration check on PRs),
`security.yml` (dependency audit gate, gitleaks secret scan; also weekly and on demand), `deploy.yml` (after CI passes on `main`: deploy hook, smoke test, issue on failure).
There is one app, so no path filters: every job builds the whole thing.

## One-time setup (needs repo admin, so it is yours to run)

Repository → Settings → Secrets and variables → Actions.

| Kind | Name | Value |
|---|---|---|
| secret | `RENDER_DEPLOY_HOOK_URL` | Render → service → Settings → Deploy Hook (a URL with `?key=...`) |
| secret | `SMOKE_EMAIL`, `SMOKE_PASSWORD` | A dedicated, low-privilege user in a dedicated **smoke workspace** in production. Not a real customer or your own account |
| variable | `PRODUCTION_BASE_URL` | `https://<service>.onrender.com` (or your domain), no trailing slash |
| secret / variable (optional staging) | `STAGING_DEPLOY_HOOK_URL`, `STAGING_SMOKE_EMAIL`, `STAGING_SMOKE_PASSWORD` / `STAGING_BASE_URL` | Same for a staging service on a Neon branch. When `STAGING_BASE_URL` is unset, deploy goes straight to production |

Settings → Environments: create `production` (and `staging`). Add **required reviewers** to `production` if you want a manual approval before each deploy.
Render must have **auto-deploy off** (`render.yaml` does this), or every merge deploys twice.

## Branch protection for `main`

Run after the first CI run has finished, so the check names exist (`gh` must be logged in as an admin):

```bash
gh api -X PUT repos/Kawshik-khan/AXIL/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["Type-check, tests, build", "Migration check", "Dependency audit", "Secret scan"] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 1, "dismiss_stale_reviews": true },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

With a single maintainer, a required review blocks your own merges: set `required_approving_review_count` to 0 (checks still gate the merge), or add a second reviewer. Private repos on a free plan may not offer branch protection at all.

## What each gate does

- **Eval gate** (`evals/thresholds.json`, `npm run test:eval`): runs the golden dataset offline against the demo AI (no cost, deterministic) and fails when a score drops below the floors. It guards routing, handoff and policy behavior, not a live model's quality.
- **RAG replay gate** (`evals/rag-mvp-thresholds.json`, `npm run rag:replay:offline`): runs the versioned seed queries against an isolated fixture tenant with provider and hosted Qdrant credentials masked. It checks retrieval, citation support, abstention, stale citations and cross-tenant leakage; CI keeps `tests/rag-replay-report.json` as a 14-day artifact. The current dataset is an unreviewed seed, and its passing floors are regression controls—not production semantic-quality targets. Live replay is separate (`npm run rag:replay:live -- --confirm-live-cost`), may incur provider cost and is not run by CI.
- **Audit gate** (`scripts/audit-gate.mjs`): fails on high/critical advisories not in `security/audit-exceptions.json` (each with a reason and an expiry). The list is empty since the Next 16.3.7 upgrade.
- **Secret scan** (`security.yml`, job `Secret scan`): a pinned, checksum-verified gitleaks CLI scans the whole git history of the
  checked-out commit on every PR and push to `main`; the weekly and manual runs scan every branch and tag. Rules and narrow
  exceptions are in `.gitleaks.toml` (all built-in rules on; only the entropy-based `generic-api-key` rule is relaxed, for
  `tests/` and for environment-variable names). Reviewed one-off false positives are in `.gitleaksignore`. A failing run lists
  each finding (redacted) in the job summary and keeps the JSON report as a 14-day artifact. See "Handling a secret scan failure".
- **Migration check** (`scripts/check-migrations.mjs`): every new migration needs `-- rollback:`; destructive statements need `-- allow-destructive: <reason>`; existing migrations can't be edited.
- **Smoke test** (`scripts/smoke-deploy.mjs`): waits for `/health` and the full `/health/ready`, then signs in to the smoke workspace and reads orders and products. It is read-only on purpose. A failure opens a GitHub issue; roll back from Render (Events → Rollback).

## Handling a secret scan failure

Run the same scan locally (gitleaks 8.30.1, the version pinned in `security.yml`): `gitleaks git . --log-opts="--all" --redact`.
Then, for each finding in the job summary:

1. **Real secret** (even if it was "only" on a branch, or already deleted): rotate or revoke it at the provider first. Removing
   it from the code does not remove it from history, and anyone with read access may already have it. Record it as an
   incident (`/incident-response`). Rewriting history is optional and only after rotation; it needs every collaborator to re-clone.
2. **Fake value in a test**: build it at runtime (`crypto.randomBytes(24).toString("hex")`), or keep it under `tests/`, where
   the entropy rule is already relaxed. Provider-shaped fakes (`ghp_...`, `sk_live_...`, `AKIA...`) are still flagged there: don't
   make fixtures look like real provider keys.
3. **Other reviewed false positive**: add its fingerprint (from the summary) to `.gitleaksignore`, with a comment saying who
   reviewed it, when, and why it is not a secret. Never widen `.gitleaks.toml` to silence a single finding.

Upgrading gitleaks: change `GITLEAKS_VERSION` and `GITLEAKS_SHA256` in `security.yml` together, using the linux_x64 line of
the release's `gitleaks_<version>_checksums.txt`, and run the local scan with the new version first (rule changes can add findings).

## Rollback

Disable a workflow from the Actions tab, or revert the PR. Deploys roll back in Render. Removing branch protection: Settings → Branches.
