# CI/CD setup (production readiness R5)

Workflows in `.github/workflows/`: `ci.yml` (type-check, `npm test`, `npm run test:pg`, `npm run test:eval`, build, migration check on PRs),
`security.yml` (dependency audit gate, gitleaks; also weekly), `deploy.yml` (after CI passes on `main`: deploy hook, smoke test, issue on failure).
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
- **Audit gate** (`scripts/audit-gate.mjs`): fails on high/critical advisories not in `security/audit-exceptions.json` (each with a reason and an expiry, currently 2026-11-30). The 15 listed are Next 14 advisories with fixes only in Next 15.5.x/16.x.
- **Migration check** (`scripts/check-migrations.mjs`): every new migration needs `-- rollback:`; destructive statements need `-- allow-destructive: <reason>`; existing migrations can't be edited.
- **Smoke test** (`scripts/smoke-deploy.mjs`): waits for `/health` and the full `/health/ready`, then signs in to the smoke workspace and reads orders and products. It is read-only on purpose. A failure opens a GitHub issue; roll back from Render (Events → Rollback).

## Rollback

Disable a workflow from the Actions tab, or revert the PR. Deploys roll back in Render. Removing branch protection: Settings → Branches.
