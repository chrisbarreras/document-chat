# Implementation Plan

Tiers, execution principles, and working agreements for delivery. For
business context see [goals.md](./goals.md); for technology and structure
see [architecture.md](./architecture.md).

## Engineering principles

### Test-first

- Every behavior starts with a failing test. No "I'll add tests later."
- Test pyramid: many unit, fewer integration, a few E2E.
- **Golden Q&A regression suite** from the first retrieval feature — this is
  the single most important test asset in the project.
- Coverage is a signal, not a target. Reviewer asks "what behavior does this
  test pin down?" not "is the percentage going up?"

### CI from day 1

- GitHub Actions on every push: lint, typecheck, unit tests, contract tests,
  build. **Tier 0 ships green CI before any feature code lands.**
- PR previews via Vercel.
- Branch protection on `main`: no merge without green CI + 1 approval.
- Deploy on merge to `main`.
- Nightly: full eval-set run, dependency audit.

### Incremental

- Every tier ends with: code + tests + docs + deployed.
- A tier's "definition of done" is non-negotiable — don't start the next tier
  with the current one half-finished.
- ADRs (one-page markdown) capture non-obvious decisions so future-you and
  new contributors aren't reverse-engineering rationale.

---

## Tiers

Each tier lists: **scope**, **deliverables**, **test strategy**, and
**definition of done**. Tickets/PRs map cleanly to deliverable bullets.

### Tier 0 — Foundation — **PUBLIC**

> Lives in `knowledge-graph-starter` (Apache 2.0).

**Goal:** Deployable hello-world with every engineering practice wired up. No
features yet — just the chassis. All Tier 0 endpoints are unauthenticated;
auth wiring lands in Tier 1.

**Scope:**

- Monorepo scaffold (pnpm workspaces).
- OpenAPI spec stub with `/health` and `/version` endpoints.
- Generated client from spec.
- Backend stub implementing the spec.
- Frontend stub calling the backend.
- Supabase project provisioned, local dev via `supabase start`.
- GitHub Actions: lint, typecheck, unit, contract test, build.
- Vercel deploy on merge to `main`.
- README with run-locally instructions (target: clone → working in <15 min).
- ADR template + first ADR (e.g., "why monorepo," "why OpenAPI").

**Deliverables (parcelable PRs):**

1. Monorepo scaffold + tooling config
2. OpenAPI spec + client generation pipeline
3. Backend `/health` + `/version` implementation
4. Frontend hello-world consuming the client
5. GitHub Actions workflow (lint, typecheck, test, build)
6. Vercel deploy + PR preview integration
7. Supabase project + local dev setup + first migration
8. README + CONTRIBUTING + ADR template

**Test strategy:**

- Unit: trivial example test in each package so the runner is wired.
- Contract: assert backend response shapes match the OpenAPI spec.
- E2E: Playwright smoke test that loads the homepage.

**Definition of done:**

- New developer clones, installs, and sees hello-world in <15 minutes.
- CI is green on `main`.
- PR previews work.
- Contract test passes.

---

### Tier 1 — Portfolio MVP — **PUBLIC**

> Lives in `knowledge-graph-starter` (Apache 2.0). Once Tier 1 ships, the
> public repo is the published portfolio asset. The private commercial repo
> forks from this point.

**Goal:** Working document Q&A with citations and a small evaluation
harness. This is the public/Upwork portfolio piece.

**Scope:**

- Auth: signup / login via Supabase Auth.
- Workspaces: single workspace per user in v1 (explicit non-goal: multi-tenant).
- Document upload (PDF first; .docx, .md as stretch).
- Async ingestion via Inngest: extract → chunk → embed → store. Scanned/image
  PDFs (no embedded text) fall back to OCR (Claude vision by default,
  `OCR_PROVIDER`-swappable) before chunking.
- Document metadata: `title`, `version`, `status` (draft / current / retired),
  `effective_date`.
- Chat: streaming responses, conversation history.
- **Citations:** every answer includes inline references to specific source
  passages (doc + chunk + page if available).
- **Eval harness:** golden Q&A set (~20 questions), citation-precision metric,
  runnable from CLI and CI.
- Public GitHub repo + deployed demo.

**Deliverables (parcelable PRs):**

1. Supabase Auth integration + protected routes
2. Workspace + document schema migrations
3. Upload endpoint + UI
4. Inngest setup + extraction job (PDF)
5. Chunking strategy (with tests for different document shapes)
6. Embedding job + pgvector storage
7. Retrieval function (vector search with metadata filters)
8. Chat endpoint with streaming + citation extraction
9. Chat UI with citation display
10. Eval harness package + first golden set
11. CI integration of eval (runs on retrieval-touching PRs)
12. Deploy + README polish + demo screenshots

**Test strategy:**

- Unit: chunking strategies, citation extraction parser, retrieval scoring.
- Integration: full upload → query → answer flow against a test database.
- E2E: signup → upload → chat → see citation.
- **Eval: golden set must run green on every PR touching retrieval.**

**Definition of done:**

- Demo is live and works end-to-end on real PDFs.
- README has architecture diagram, screenshots, deploy instructions.
- Eval harness reports citation precision + answer relevance on the golden set.
- Repo is public.

---

### Tier 2 — Production hardening — **PRIVATE**

> First tier in `knowledge-graph` (proprietary). Forks from the public
> starter at end of Tier 1.

**Goal:** Multi-tenant, billable, observable. Ready to put a paying customer on it.

**Scope:**

- Multi-tenant: teams with row-level security in Postgres.
- **Permission-aware retrieval:** retrieval filters chunks by what the
  querying user can see. This is the most common production failure mode in
  enterprise RAG — treat it as a first-class concern.
- Stripe Billing: subscription plans, usage tracking, customer portal.
- Audit logs: who queried what, who uploaded what, who retired what.
- LLM observability: Langfuse traces for every chat turn.
- Error monitoring: Sentry.
- Rate limiting (per-workspace + per-user).
- Admin interface (basic).

**Test strategy:**

- **Authorization tests are top priority.** Confirm tenant A cannot retrieve
  tenant B's chunks. Make these tests load-bearing in CI.
- Stripe webhook handling tests with replay.
- Audit-log completeness tests (every mutation produces a log row).

**Definition of done:**

- Two test tenants cannot see each other's data (proven by automated test).
- Stripe checkout → subscription → usage limit → upgrade path all work.
- Every chat turn produces a Langfuse trace + an audit-log entry.

---

### Tier 3 — Document lifecycle — **PRIVATE**

> `knowledge-graph` (proprietary). Core commercial IP — keep it private.

**Goal:** Supersession-aware retrieval. The first big differentiator from
generic vector-RAG products.

**Scope:**

- Document version graph: track parent/child versions.
- Supersession workflow: marking doc A as superseded by doc B.
- Lifecycle states: `draft → approved → current → retired → superseded`.
- Retrieval filters: exclude retired/superseded docs by default; opt-in for
  "as-of-date X" queries.
- Admin UI for lifecycle transitions.
- Eval metric: "did we cite a retired doc?" — explicit failure mode.

**Test strategy:**

- Time-travel: query "as of date X" returns the right version of each doc.
- Supersession cascade: retiring doc A correctly affects downstream answers.
- Eval set extended with supersession-specific questions.

**Definition of done:**

- A document that supersedes another correctly excludes the predecessor from
  retrieval, and the eval set proves it.
- "As of [date]" queries work and are documented.
- Demo can show a "retired document" failure mode that pure vector RAG would miss.

---

### Tier 4 — Knowledge graph layer — **PRIVATE**

> `knowledge-graph` (proprietary). The upmarket differentiator and the
> highest-margin services upsell.

#### Phase 4a — Triples in Postgres

**Scope:**

- Triple store table: `(subject, predicate, object)` + provenance columns
  (`source_doc`, `source_chunk`, `effective_date`, `asserted_at`, `retracted_at`).
- LLM-assisted entity + relation extraction during ingestion.
- Entity resolution: canonical IDs + aliases table.
- Hybrid retrieval: vector chunks + graph traversal results blended in the
  context window.
- **Truth-maintenance:** when a source document is retired, cascade-retract
  triples whose provenance depends solely on that source.
- Domain ontology: small, hand-curated, evolving.

**Test strategy:**

- Property-based tests on triple insertion + retraction.
- Cascade-retraction tests: retire source → dependent triples retracted.
- Hybrid-retrieval eval: questions that require multi-hop reasoning.

#### Phase 4b — Real SPARQL

**Scope:**

- Apache Jena / Fuseki sidecar OR Stardog (decision: write an ADR before starting).
- LLM emits SPARQL via curated query templates (text-to-SPARQL via templates
  is more reliable than free-form generation).
- OWL reasoning where it pays off (start with RDFS, add OWL profiles as needed).
- Ontology-workshop offering (services / consulting deliverable).

**Definition of done (Tier 4):**

- A question requiring multi-hop reasoning over entities is answered
  correctly using the graph, and the eval set proves it.
- A retired-source cascade produces measurably different retrieval
  results before vs. after.

---

## Beyond the tiers — deferred enhancements

Sequenced **after Tiers 1–4 ship** — don't pull forward (see the parking lot in
[goals.md](./goals.md#out-of-scope-topics-parking-lot)).

- **Mobile.** The app is web-first (Next.js + shadcn/ui). When mobile is
  warranted, escalate in cost order, reusing the API-first contract and the
  generated TS client with **no backend changes**:
  1. **PWA** — add a manifest + service worker (installable, web-push, basic
     offline). ~100% reuse, no rewrite.
  2. **Capacitor** — wrap the existing web UI in a native shell for App Store /
     Play Store presence + native APIs (camera, push). ~100% UI reuse.
  3. **React Native / Expo** — only if a mobile-*native* capability becomes a
     differentiator (on-device document capture → upload via the existing
     signed-URL flow; push on ingestion `ready`). Reuses the API client + data
     layer + types; the shadcn/Tailwind view layer is rebuilt (NativeWind /
     Tamagui). Gate behind an ADR.

---

## Working agreements

Two-person team, one a recent CS grad. These agreements protect code quality
and serve as a learning scaffold.

- **PRs only.** Branch protection enforces this. No direct pushes to `main`.
- **One reviewer minimum.** Pair on the first 2–3 PRs in each tier to set
  conventions. Pair-programming is a deliberate teaching tool, not lost time.
- **Definition of Done is non-negotiable:** code + tests + docs + green CI +
  deployed (for Tier ≥1). A PR that skips any of these gets re-opened.
- **Test plan in every PR description.** What did you test manually? What's
  automated? Reviewer reads this first.
- **ADRs for non-obvious choices.** One page max. Why we picked Inngest, why
  pgvector over Pinecone, why we deferred SPARQL.
- **Conventional commits.** `feat:`, `fix:`, `chore:`, `docs:`. Enables
  automated changelog generation later if useful.
- **Tickets reference tier.** GitHub issue labels: `tier-0`, `tier-1`, etc.
  Prevents scope creep into later tiers.
- **Test the contract, not the implementation.** Tests survive refactors.
- **Junior gets first crack at the "good first issue" backlog.** Easier
  tickets with well-defined boundaries; senior reviews thoroughly.
- **License headers** on every source file in the public repo (short Apache
  2.0 header). Lint enforces in CI.
- **Inbound = outbound licensing.** Contributions are accepted under Apache 2.0
  (no CLA or DCO sign-off). CONTRIBUTING.md states this.
- **Public-first for non-differentiating work.** Default: bugfixes,
  infrastructure improvements, and general retrieval/eval quality go in the
  public repo unless there's a reason to keep them private. Commercial
  features default private. When in doubt, raise it in the regular sync.

---

## Execution risks

| Risk | Mitigation |
|---|---|
| Scope creep into Tier 4 (KG) too early | Every PR labeled with tier; KG work waits for Tier 3 to ship |
| Eval harness rots | Golden set updated alongside features; CI fails if eval runner errors; nightly full eval run |
| Junior productivity ramp | Pair-programming on first ticket per tier; explicit "good first issue" backlog; written ADRs for context |
| Sync drift between public and private | Regular sync from `upstream/main` in private repo; CI in private repo runs against latest public main nightly |
| Burnout from infinite scope | Tier-by-tier shipping discipline; resist Tier 4 daydreaming until Tiers 1–3 are paid for |

For business-level risks (competitor forking, license compliance, support
burden), see [goals.md](./goals.md#business-risks).

---

## What to start first

**Tier 0, day-one ticket:** "Monorepo scaffold + green CI on a hello-world
endpoint."

Not "let's design the KG schema." Not "let's pick the perfect chunking
strategy." The first ticket is the chassis — once CI is green on a
hello-world, every subsequent PR rides those rails.

Anything more ambitious as the first ticket creates rework when you discover
the project structure doesn't fit your workflow.

---

## See also

- [goals.md](./goals.md) — business goals and project structure
- [architecture.md](./architecture.md) — technology choices and system shape
