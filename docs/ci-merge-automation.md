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

3. **Branch protection on `main`** — Settings → **Branches** (under "Code and
   automation") → **Add branch protection rule**. Then:

   1. **Branch name pattern:** `main`
   2. ✅ **Require a pull request before merging**
      - **Required approvals:** set to **0** (we don't review each other's work).
      - Leave "Dismiss stale approvals", "Require review from Code Owners", and
        "Require approval of the most recent reviewable push" **unchecked**.
      - (This blocks direct pushes to `main` so everything goes through a PR —
        but needs no reviewer.)
   3. ✅ **Require status checks to pass before merging**
      - In the search box, add each of these (type the name, click it):
        `build`, `integration`, `eval-mock`, `scan`, `no-floating-refs`.
      - ❌ **Leave "Require branches to be up to date before merging" UNCHECKED.**
        Checking it forces the *Update branch* merge that previously produced
        unsigned merge commits and a corrupted `pnpm-lock.yaml`. Off lets
        auto-merge handle out-of-date branches itself.
      - Note: a check only appears in the picker after it has run at least once.
        They've all run on recent PRs, so they should be searchable. `smoke` and
        `eval-live` are intentionally skipped — **don't** require them.
   4. Leave everything else at defaults (no "require signed commits", no "require
      linear history", no "require conversation resolution" unless you want them).
   5. Optional: leave **"Do not allow bypassing the above settings" unchecked** so
      an admin can still force a merge in an emergency.
   6. Click **Create** (or **Save changes**).

   > Newer "Rulesets" UI instead of classic rules? Settings → **Rules → Rulesets
   > → New branch ruleset** → Target = `main` → enable **Require a pull request**
   > (0 approvals) and **Require status checks to pass** with the same five checks;
   > keep "Require branches to be up to date" off. Either mechanism works.

## Result

Open a non-draft PR → `automerge.yml` turns on auto-merge (squash) → GitHub
merges it the moment the required checks are green. Until step 1 is done the
workflow is a harmless no-op.

To opt a PR out, mark it a **draft** (the workflow skips drafts) or run
`gh pr merge --disable-auto <number>`.
