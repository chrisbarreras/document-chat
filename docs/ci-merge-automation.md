<!-- SPDX-License-Identifier: Apache-2.0 -->

# CI merge automation

Policy: **a PR merges automatically once the required status checks pass — no
review required.** Implemented with GitHub's native auto-merge, enabled per-PR
by `.github/workflows/automerge.yml`.

The DCO sign-off check was removed (low value for this two-maintainer repo, and
it caused frequent red builds on merge commits).

## One-time owner setup (admin-only — `chrisbarreras`)

These require **admin** on the repo, so the owner must do them once. The rest of
the automation is already in the repo.

1. **Allow auto-merge** — Settings → General → *Pull Requests* → check
   **Allow auto-merge**. (Optionally also **Automatically delete head branches**.)

2. **Actions write permission** — Settings → Actions → General → *Workflow
   permissions* → select **Read and write permissions**. (Lets `automerge.yml`
   enable auto-merge via `GITHUB_TOKEN`.)

3. **Branch protection on `main`** — Settings → Branches → *Add branch ruleset*
   (or protection rule) for `main`:
   - **Require status checks to pass** — add: `build`, `integration`,
     `eval-mock`, `scan`, `no-floating-refs`. (These are the always-running CI
     jobs; `smoke` and `eval-live` are intentionally skipped, so don't require
     them.)
   - **Do NOT** require pull request reviews (0 approvals).
   - **Do NOT** enable "Require branches to be up to date before merging" —
     that forces the *Update branch* merge that previously produced unsigned
     merge commits and a corrupted lockfile. Leaving it off lets auto-merge
     handle out-of-date branches itself.

## Result

Open a non-draft PR → `automerge.yml` turns on auto-merge (squash) → GitHub
merges it the moment the required checks are green. Until step 1 is done the
workflow is a harmless no-op.

To opt a PR out, mark it a **draft** (the workflow skips drafts) or run
`gh pr merge --disable-auto <number>`.
