# Deploy & local development

This guide covers running the starter locally and deploying it to Vercel.
For the system shape see [../architecture.md](../architecture.md); for the
delivery plan see [../implementation.md](../implementation.md).

## Local development

### Prerequisites

- **Node 20 LTS** (see `.nvmrc`). `nvm use` if you use nvm.
- **pnpm 9** — `corepack enable pnpm` (ships with Node), or install per
  <https://pnpm.io/installation>.
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

### Run with background jobs (Tier 1+ ingestion)

Document ingestion runs as Inngest functions registered at
`/api/inngest`. Locally the Inngest CLI's dev server discovers them over
HTTP. In a third terminal, after `pnpm dev` is up:

```bash
pnpm dev:inngest      # npx inngest-cli dev -u http://localhost:3000/api/inngest
```

Open <http://localhost:8288> for the Inngest dev UI (function list, run
history, replays). The dev server is unauthenticated, so `INNGEST_EVENT_KEY`
and `INNGEST_SIGNING_KEY` can be left blank in `.env.local`. In production,
set both on Vercel from the Inngest Cloud dashboard.

Migrations live in [`supabase/migrations/`](../supabase/migrations/). The
Tier 0 baseline migration only enables the `vector` and `pgcrypto`
extensions; feature schema arrives with Tier 1.

### Try the Tier 1 demo end-to-end

After `pnpm dev:all` + `pnpm dev:inngest`:

1. Sign up at <http://localhost:3000/auth/sign-up>.
2. Open <http://localhost:3000/documents> and upload a small PDF.
3. Click the document to watch ingestion progress stream (extracting →
   chunking → embedding → ready) via the SSE panel.
4. Open <http://localhost:3000/chats>, start a new chat scoped to that
   document, and ask a question. Tokens stream in; citation chips appear
   as the answer references retrieved chunks.

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
4. **Environment variables** (*Settings → Environment Variables*) — see the
   matrix below.
5. **Enable preview deployments** for pull requests (on by default).

### Production environment matrix

| Variable | Scope | Source | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Prod, Preview, Dev | Supabase dashboard → Settings → API | Browser-visible; safe to expose. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Prod, Preview, Dev | Supabase dashboard → Settings → API | Browser-visible; safe to expose. |
| `SUPABASE_SERVICE_ROLE_KEY` | Prod, Preview | Supabase dashboard → Settings → API | **Server-only secret.** Never prefix with `NEXT_PUBLIC_`. |
| `INNGEST_EVENT_KEY` | Prod, Preview | Inngest Cloud → Manage → Event Keys | Used by the `/api/inngest` send call. |
| `INNGEST_SIGNING_KEY` | Prod, Preview | Inngest Cloud → Manage → Signing Keys | Used by the SDK to authenticate webhook deliveries. |
| `OPENAI_API_KEY` | Prod, Preview | <https://platform.openai.com/api-keys> | Embeddings for ingestion + retrieval. |
| `ANTHROPIC_API_KEY` | Prod, Preview | <https://console.anthropic.com/> | Chat completion. |

Per-environment guidance:

- **Production** uses the dedicated prod Supabase project + prod Inngest
  environment + your prod-scoped API keys (low monthly cap recommended).
- **Preview** can share the prod project for ergonomics, but the safer
  default is a separate `dev` Supabase project so a destructive migration
  on a PR can't touch production data. Match Inngest's `dev` environment to
  the same project.
- **Development (local)** uses `pnpm db:start` for Supabase and the Inngest
  CLI dev server (no `INNGEST_*` keys needed). Generate a low-cap key pair
  on OpenAI + Anthropic for your `.env.local`.

`VERCEL_ENV` and `VERCEL_GIT_COMMIT_SHA` are injected by Vercel
automatically, so `/api/version` reports the environment and git SHA with
no configuration (see [`apps/web/lib/build-info.ts`](../apps/web/lib/build-info.ts)).

### Inngest Cloud connection

The `/api/inngest` route is the SDK's serve handler — it auto-registers
the functions defined under [`apps/web/lib/inngest/functions/`](../apps/web/lib/inngest/functions/).
In Inngest Cloud:

1. Create an app named `document-chat`.
2. Add a synced URL pointing at `https://<your-deployment>/api/inngest`.
3. Copy the `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` into the Vercel
   project's environment variables for the matching environment (Prod gets
   the prod keys, Preview gets the dev keys).
4. Redeploy. The Inngest "Functions" tab should list `extract-document`,
   `chunk-document`, and `embed-chunks` within a minute.

If the function list is empty, hit `/api/inngest` directly — the SDK
prints a JSON registration response that explains what it discovered.

## Verify a deployment

After the first deploy, run the smoke script against the deployment URL:

```bash
pnpm tsx scripts/smoke.ts --base-url https://<your-deployment>.vercel.app
```

It probes `/api/health` (expects `status: "ok"`) and `/api/version` (expects
the deployed `environment` and a non-empty `git_sha`), and exits non-zero
on the first failure. The same script runs in the
[`smoke.yml`](../.github/workflows/smoke.yml) workflow on push to `main`.

## CI required checks

The Tier 1 merge gate is two GitHub Actions checks plus the existing
gitleaks + DCO checks. Mark these required on `main` in *Settings → Branches
→ Branch protection rules → main*:

- **`ci / build`** — lint, typecheck, contract drift, unit tests, build,
  Playwright E2E.
- **`ci / integration`** — Supabase-backed integration tests.
- **`eval / eval-mock`** — golden-set eval against canned transcripts
  (REQ-1.5.3 threshold).
- **`dco`**, **`gitleaks`** — sign-off + secret scanning.

The `eval / eval-live` job (real OpenAI + Anthropic) is **not** required —
it runs on a nightly cron and on `workflow_dispatch` only.

## Secret hygiene

`gitleaks` scans every push and PR (see
[`.github/workflows/gitleaks.yml`](../.github/workflows/gitleaks.yml)). Never
commit `.env.local` or real keys — they belong in Vercel env vars (deploy) and
`.env.local` (local, gitignored). To scan locally before pushing:

```bash
gitleaks detect --no-banner
```
