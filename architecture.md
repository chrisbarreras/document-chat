# Architecture

System shape, technology choices, and structural decisions for both repos.
For business context see [goals.md](./goals.md); for delivery process see
[implementation.md](./implementation.md).

## API-first contract architecture

- **OpenAPI 3.1 spec is the source of truth** for every backend contract.
- Spec lives in `packages/contracts/openapi.yaml`, versioned, reviewed in PRs.
- Backend implements the spec; frontend consumes a **generated TypeScript client**.
- **Contract tests** run in CI: assert backend responses match the spec.
- Spec changes require a PR — no implementation-led API drift.

Benefit: frontend and backend can be developed in parallel against a stable
contract. One person can stub a route while the other builds the UI, and they
meet at the spec.

### Streaming and contract tests

- The chat endpoint declares `text/event-stream` in the OpenAPI spec. SSE event
  shape lives in a sibling `chat-events.schema.json` referenced from the spec.
- REST endpoints are contract-tested via Prism / generated assertions. SSE
  event shapes are verified by Vitest fixtures against the JSON schema —
  Prism doesn't cover SSE.
- The generated TypeScript client is **checked in**. `pnpm contracts:generate`
  regenerates it; CI fails if regeneration produces a diff. Forkers don't
  run codegen on first clone.
- Breaking spec changes require a major version bump in the spec plus a
  migration note in `CHANGELOG.md`.

---

## Technology choices

### Core stack (Tiers 0–3)

| Layer | Choice | Why |
|---|---|---|
| Package manager | pnpm 9.x (workspaces + catalogs) | Fast, strict, monorepo-native |
| Node runtime | Node 20 LTS | Required floor for Next 15; supported by Supabase and Vercel |
| Build orchestration | Turborepo | Task graph + remote cache (Vercel free tier includes the cache) |
| Frontend | Next.js 15 (App Router) + React + TypeScript | Industry default, strong Vercel integration, RSC-capable |
| Frontend data fetching | TanStack Query v5 + RSC | TanStack for client mutations and SSE chat; RSC for static reads |
| UI | Tailwind + shadcn/ui | Avoid building a design system |
| Backend | Next.js Route Handlers (locked through Tier 4; see ADR) | One deployable; edge-vs-Node runtime decided per route |
| Auth | Supabase Auth | JWT, row-level security integration, free tier |
| Database | Supabase Postgres + pgvector | One DB does relational + vector; cheaper than a separate vector DB at our scale |
| ORM | Drizzle (with drizzle-kit) | TypeScript-first, light cold-start, Supabase-friendly |
| Storage | Supabase Storage | Per-env bucket, RLS, signed upload URLs (see Storage section) |
| Migrations | drizzle-kit (schema) + Supabase CLI (RLS policies) | Schema in Drizzle; auth/RLS SQL in Supabase migrations |
| PDF extraction | unpdf (primary), pdf-parse (fallback) | unpdf is serverless-safe; pdf-parse covers malformed files |
| OCR (scanned PDFs) | Mistral OCR (default), or Claude vision, selected via `OCR_PROVIDER`; behind an `OcrProvider` interface in `packages/retrieval` | Runs only when a PDF has no embedded text. `mistral` is a dedicated OCR engine (no LLM content filter, lower per-page cost) — the default, best for contract/form corpora; `claude` reuses the Anthropic key (no new vendor) but its output filter blocks verbatim reproduction of standardized boilerplate (e.g. mandated legal notices in contracts) |
| Email (transactional) | Resend | Pairs with Supabase Auth for verification/reset email |
| LLM (primary) | Anthropic Claude | Best citation behavior in our use case |
| LLM (secondary) | OpenAI | For comparison, fallback, and keyword breadth |
| Embeddings | OpenAI `text-embedding-3-small` (1536d, locked through Tier 3) | Schema records `embedding_model` per chunk so a future swap is per-doc, not a flag-day |
| Hosting | Vercel | Pairs with Next.js; PR previews built-in |
| CI | GitHub Actions | Free for public repos |
| Background jobs | Inngest | Durable, typed, integrates with Vercel; introduced at Tier 1 |
| Observability | Langfuse (LLM) + Sentry (errors) | OSS-friendly LLM tracing + standard error monitoring |
| Billing | Stripe | Default; introduced at Tier 2 |
| Eval | Custom harness in `packages/eval` + Ragas where useful | Owned IP |
| Secrets (local) | Doppler / 1Password CLI | Shared dev secrets without committing them |
| Secrets (deploy) | Vercel env vars | Built-in, per-environment |
| Secrets scanning | gitleaks | Pre-commit hook + CI job |
| Pre-commit | Husky + lint-staged | Wires lint/format/typecheck/gitleaks on staged files |

### Tier 4 (KG) candidates

- **Phase 4a:** Triples stored in Postgres (no new infrastructure).
- **Phase 4b:** Apache Jena / Fuseki as OSS SPARQL endpoint, OR Stardog if
  going commercial. Decision deferred until 4a proves the need; ADR required
  before starting.

### Library choices (specifics)

- **OpenAPI tooling:** openapi-typescript (types), Zod (runtime validation
  on the boundary), Spectral (lint the spec in CI), Prism (mock server for
  frontend dev).
- **Testing:** Vitest (unit + integration), Playwright (E2E), MSW (network mocking).
- **Linting:** ESLint + Prettier + TypeScript strict.

---

## Storage

- **Supabase Storage**, one bucket per environment (`uploads-dev`, `uploads-prod`).
- **RLS on the bucket from day one.** Cheaper to land in Tier 0 than retrofit
  when Tier 2 multi-tenancy arrives.
- **Signed upload URLs.** The browser uploads directly to Supabase Storage,
  not through Next handlers. This avoids the 4.5 MB body limit on Vercel
  serverless functions and supports the 50 MB upload target in REQ-1.1.1.
- Storage policies are versioned alongside `supabase/migrations/` under
  `supabase/storage/`.

---

## Local development orchestration

- `pnpm dev` runs a Turbo task that starts `supabase start`, the Inngest dev
  server, and `next dev` concurrently.
- Step-by-step instructions live in `docs/deploy.md`.
- Target: clone → `pnpm install && pnpm dev` → working in under 15 minutes
  (matches Tier 0's Definition of Done in implementation.md).

---

## Frontend data layer

- **TanStack Query v5** for client-side mutations and SSE-streamed chat.
- **React Server Components** for static reads (document list, document detail).
- The generated TypeScript client from OpenAPI is the transport; TanStack
  Query wraps it.
- **No client-side state library** (Zustand / Redux / Jotai / etc.) until a
  concrete need surfaces. Keep the dependency surface small.

---

## Pre-commit tooling

- **Husky + lint-staged.** Format, lint, and typecheck staged files.
- **gitleaks.** Scan staged content for secrets. Runs in both pre-commit
  and CI.
- **License-header check.** Lint script ensures every source file in the
  public repo carries the short Apache 2.0 header.
- **`check-commercial-leakage.sh`.** Scans staged files for known
  private-only package names (per goals.md business risks). Runs in both
  repos; in the public repo it's a hard failure.

---

## Cost and rate-limit guardrails

- Per-provider spend caps configured in the OpenAI and Anthropic consoles
  during Tier 0 provisioning.
- Langfuse cost-per-trace alerts from Tier 2 onward.
- Vector index size and per-workspace usage tracking from Tier 2
  (REQ-2.2.2).
- Per-workspace and per-user rate limits at the API boundary from Tier 2
  (REQ-2.NF.1 / NF-SEC.3).
- Optional nightly cost-report job posting to a Slack/Discord channel
  (Tier 2+).

---

## Repo layout

Two repos. Both share the same underlying monorepo shape; the private one is
a superset that adds packages and apps.

> **Tier 0 endpoints are unauthenticated.** Auth wiring is a Tier 1
> deliverable (see implementation.md Tier 1 scope). The hello-world chassis
> in Tier 0 does not require sign-in.

**Package scopes.** Public-repo workspace packages publish under
`@document-chat/<name>` (e.g., `@document-chat/contracts`,
`@document-chat/eval`). The private fork uses
`@document-knowledge-graph/<name>`. `apps/web` is unscoped. Scopes are
independent of GitHub repo names — either repo can be renamed without
churning import paths. See [goals.md](./goals.md#npm-package-scopes).

### Public starter — `knowledge-graph-starter` (Apache 2.0)

```
knowledge-graph-starter/
├── LICENSE                 # Apache 2.0
├── NOTICE                  # Required by Apache 2.0
├── CONTRIBUTING.md         # contribution guide, PR process
├── CODE_OF_CONDUCT.md      # Contributor Covenant
├── apps/
│   ├── web/                # Next.js frontend + Route Handlers
│   └── eval-cli/           # Standalone CLI for the eval harness
├── packages/
│   ├── contracts/          # OpenAPI specs + generated TypeScript client
│   ├── eval/               # Golden Q&A harness, metrics, runners
│   ├── logging/            # Structured logger + correlation IDs (cross-phase, NF-OBS.1)
│   └── retrieval/          # Embedding, chunking, retrieval
│       └── src/providers/  # anthropic.ts, openai.ts — LLM provider abstraction (goals.md)
├── supabase/
│   └── migrations/         # SQL migrations
├── .github/
│   ├── workflows/          # CI: lint, typecheck, test, build, deploy
│   ├── ISSUE_TEMPLATE/
│   └── PULL_REQUEST_TEMPLATE.md
└── docs/
    ├── adr/                # Architecture decision records
    ├── architecture.md     # Diagram + narrative
    └── deploy.md           # Self-deployment guide for forkers
```

### Private commercial — `knowledge-graph` (proprietary)

Forks from `knowledge-graph-starter` at end of Tier 1. Adds:

```
knowledge-graph/                # (forked from starter; same scaffold)
├── apps/
│   ├── web/                    # Extended with multi-tenant UI + billing flows
│   ├── admin/                  # NEW — admin dashboard, separate auth surface + RBAC (Tier 2, REQ-2.NF.3)
│   └── eval-cli/
├── packages/
│   ├── contracts/              # Extended with commercial endpoints
│   ├── eval/                   # Extended with lifecycle + KG metrics
│   ├── retrieval/              # Extended with permission-aware retrieval
│   ├── lifecycle/              # NEW — document lifecycle state machine (Tier 3)
│   ├── billing/                # NEW — Stripe integration (Tier 2)
│   ├── tenancy/                # NEW — multi-tenant + RLS helpers (Tier 2)
│   ├── audit/                  # NEW — audit log writer + queries (Tier 2)
│   └── knowledge-graph/        # NEW — knowledge graph layer (Tier 4)
├── supabase/migrations/        # Adds RLS policies, billing tables, lifecycle, KG
├── .github/workflows/          # Adds deploy-to-production, eval-regression
└── docs/runbooks/              # NEW — production ops, key rotation, incident response
```

### Sync mechanics

- Private repo's `upstream` remote points at the public repo.
- Periodic sync: `git fetch upstream && git merge upstream/main` in private.
- Bugfixes that aren't commercially-differentiating are developed in **public**
  first, then pulled into private via the sync.
- Commercial features developed in private do not flow back unless we
  deliberately open-source them.
- No npm package gymnastics initially. Revisit only if package boundaries
  become genuinely stable and the duplication hurts.

---

## Architectural Decision Records

ADRs live in `docs/adr/`. One page, markdown, immutable once accepted.

**Template format: MADR 3.0** — Context, Decision, Status, Consequences,
Alternatives Considered. The first Tier 0 deliverable (per implementation.md)
is the template itself plus the first ADR.

Required ADRs:

**Structural**
- Why monorepo
- Why pnpm + Turborepo
- Why OpenAPI as the source of truth
- Why SSE alongside OpenAPI, and how it's contract-tested
- Why Next.js App Router + Route Handlers (vs a separate Fastify backend) —
  closes the previously hedged decision
- Why this public/private package split (logging public, audit private;
  provider abstraction location inside `packages/retrieval`)

**Persistence and retrieval**
- Why the Supabase bundle (auth + DB + storage + RLS) — vendor lock-in
  justification per goals.md business risks
- Why pgvector over a dedicated vector DB
- Why pgvector HNSW with `m=16, ef_construction=64`
- Why Drizzle ORM (vs Prisma vs raw SQL)
- Why Supabase Storage for uploads (signed URLs, RLS from day one)
- Why `text-embedding-3-small`, locked through Tier 3

**Application**
- Why TanStack Query for client state
- Why Claude as primary LLM
- Why Inngest over alternatives
- Why Resend for transactional email

**Future**
- (Future) Stardog vs. Fuseki for Phase 4b
- (Future) Any new vendor adoption

---

## See also

- [goals.md](./goals.md) — business goals and project structure
- [implementation.md](./implementation.md) — tiers, working agreements, execution plan
