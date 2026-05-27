# Deploy & local development

This guide covers running the starter locally and deploying it to Vercel.
For the system shape see [../architecture.md](../architecture.md); for the
delivery plan see [../implementation.md](../implementation.md).

## Local development

### Prerequisites

- **Node 20 LTS** (see `.nvmrc`). `nvm use` if you use nvm.
- **pnpm 9** — `corepack enable pnpm` (ships with Node), or install per
  <https://pnpm.io/installation>. On Windows, `corepack enable pnpm` can fail
  if Node is under `C:\Program Files` (no write permission for the shim); use
  a user-space Node (nvm/fnm or WSL), or
  `corepack enable --install-directory <a-dir-on-PATH> pnpm`.
- **Docker** — only needed once you run Supabase locally (Tier 1+).
- **Supabase CLI** — only needed for the database. Install per
  <https://supabase.com/docs/guides/cli> (`scoop install supabase` on
  Windows, `brew install supabase/tap/supabase` on macOS).

### Run the app (Tier 0 — no database needed)

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000>. The Tier 0 endpoints are
<http://localhost:3000/api/health> and <http://localhost:3000/api/version>.
Target: clone → running in under 15 minutes.

### Run with the database (Tier 1+)

```bash
pnpm db:start     # supabase start — boots Postgres, Auth, Storage in Docker
pnpm dev          # in a second terminal, or use `pnpm dev:all` for both
```

`pnpm db:start` prints the local API URL, anon key, and service-role key —
copy them into `.env.local` (see [`.env.example`](../.env.example)). Other
database commands:

- `pnpm db:reset` — drop, recreate, and re-apply every migration in
  `supabase/migrations/` (run this after pulling new migrations).
- `pnpm db:stop` — stop the local stack.
- `pnpm dev:all` — `supabase start` followed by `pnpm dev`.

Migrations live in [`supabase/migrations/`](../supabase/migrations/). The
Tier 0 baseline migration only enables the `vector` and `pgcrypto`
extensions; feature schema arrives with Tier 1.

### Local environment on Windows (WSL2)

The full local stack is ~9 Docker containers (Postgres, Auth, Storage, REST,
Realtime, Studio, etc.) plus the Next dev server. On an under-resourced
Windows box this can saturate memory and disk and freeze the host. Guidance
for running it comfortably:

**Hardware.** RAM is the one that matters — the freeze mode is memory
pressure and swapping, not CPU. Aim for **32 GB RAM**, an **NVMe** system
drive, and 8+ cores. 16 GB is a painful minimum. WSL2 and Docker data live on
`C:` by default; keep them on the NVMe (don't relocate to a slow/external
drive).

**Develop inside WSL2** (biggest single win). Clone the repo into the WSL2
filesystem (e.g. `~/projects/document-chat`), **not** `/mnt/c/...` or
`/mnt/d/...` — Docker bind-mounts and Node file-watching are dramatically
faster on the native ext4 filesystem. Install the Linux builds of the
toolchain inside WSL.

**Cap WSL2 memory** so Docker can never freeze Windows. Create
`%USERPROFILE%\.wslconfig` (this file is machine-global and is *not* part of
the repo):

```ini
[wsl2]
memory=12GB
processors=8
swap=4GB
```

Then apply it: `wsl --shutdown`, and restart Docker Desktop. Worth doing even
with 32 GB — it bounds Docker so the host stays responsive.

**New-machine toolchain checklist:**

- **Node 20 LTS** (matches `.nvmrc`) — install via a user-space manager
  (nvm/fnm) or inside WSL so `corepack enable` can write the pnpm shim
  without admin.
- `corepack enable` → **pnpm 9.15.0** (honors the pinned `packageManager`).
- **Docker Desktop** (WSL2 backend) or Docker Engine inside WSL.
- **Supabase CLI** and **`gh`**.

**You don't need local Docker to be productive.** Unit and contract tests run
without it (`pnpm test`), and the CI `integration` job runs the DB-backed
tests against Supabase on every PR (see [testing.md](./testing.md)). Local
Docker is for interactively debugging integration/E2E tests, not a
requirement for contributing.

### Moving to a new machine

All work lives on GitHub, so the cleanest path on a new machine is a fresh
`git clone` (ideally into the WSL2 filesystem, per above) — **not** copying an
old `node_modules` or moving a disk. Only the repo files and gitignored env
files (`.env.test`, `.env.local`) are local; everything that makes the project
*run* is machine state that doesn't transfer:

- **`node_modules`** — pnpm links into a per-user store; copied/moved copies
  have broken links. Always reinstall.
- **Toolchain, Docker images/volumes, Playwright browsers, git/`gh`
  credentials, the WinNAT port exclusion** — all live on the system drive /
  user profile, not in the repo.

Restart checklist:

1. **Toolchain** — Node 20 → `corepack enable` (pnpm 9.15.0) → Docker Desktop
   (WSL2 backend) → Supabase CLI → `gh` (see Prerequisites above).
2. **Dependencies** — from a fresh clone, `pnpm install`. (If you reused an
   old working copy, delete every `node_modules` first.)
3. **Re-auth** — git push credential + `gh auth login`.
4. **Database (when needed)** — `pnpm db:start` → `pnpm db:reset` → regenerate
   `apps/web/.env.test`.
5. **Playwright** — `pnpm --filter web exec playwright install chromium`.
6. **Verify** — `pnpm test` (unit, no Docker), then `pnpm build` +
   `pnpm --filter web run test:e2e`; integration only if Docker is comfortable.

## Deploy to Vercel (native Git integration)

Deployment uses Vercel's built-in Git integration — no deploy workflow and no
`vercel.json` in the repo. Push to a branch → preview deployment; merge to
`main` → production deployment.

### One-time setup

1. **Create the project.** In the Vercel dashboard, *Add New… → Project* and
   import the `document-chat` GitHub repo.
2. **Root Directory.** Set it to **`apps/web`** (*Settings → Build and
   Deployment → Root Directory*). This is the key step for this monorepo:
   Vercel then treats `apps/web` as the project root, finds the Next.js build
   output at the default `.next`, and installs workspace deps from the repo
   root automatically.
   - **Leave Build Command and Output Directory at their defaults (no
     overrides).** An Output Directory override of `apps/web/.next` is wrong
     once Root Directory is `apps/web` — Vercel resolves it relative to the
     root directory and looks for `apps/web/apps/web/.next`, which fails.
     Default (empty) Output Directory means `.next`, which is correct.
3. **Framework preset.** Next.js (auto-detected). Vercel also detects
   Turborepo and wires the build accordingly.
4. **Environment variables** (*Settings → Environment Variables*). None are
   required for the Tier 0 hello-world. Add these when Tier 1 lands, scoped to
   the right environments (Production / Preview / Development):

   | Variable | Scope | Notes |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | all | From the Supabase project (or a Vercel-managed integration). |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | all | Public anon key. |
   | `SUPABASE_SERVICE_ROLE_KEY` | Production, Preview | Server-only secret — never `NEXT_PUBLIC_`. |

   `VERCEL_ENV` and `VERCEL_GIT_COMMIT_SHA` are injected by Vercel
   automatically, so `/api/version` reports the environment and git SHA with
   no configuration (see [`apps/web/lib/build-info.ts`](../apps/web/lib/build-info.ts)).
5. **Enable preview deployments** for pull requests (on by default).

### Verify a deployment

After the first deploy, hit `/api/health` and `/api/version` on the deployment
URL. `/api/version` should report `environment: "prod"` on production and
`"preview"` on PR previews.

## Secret hygiene

`gitleaks` scans every push and PR (see
[`.github/workflows/gitleaks.yml`](../.github/workflows/gitleaks.yml)). Never
commit `.env.local` or real keys — they belong in Vercel env vars (deploy) and
`.env.local` (local, gitignored). To scan locally before pushing:

```bash
gitleaks detect --no-banner
```
