# ADR-0008: Eval harness — golden Q&A + citation metrics + CI gate

- Status: accepted
- Date: 2026-06-10
- Deciders: @tombarreras, @chrisbarreras

## Context and Problem Statement

REQ-1.5.3 fixes a measurable bar for citation correctness: ≥90% citation
precision against a golden set. Without a harness that scores every PR
against that bar, the bar is a hope, not a contract. The harness needs to
(1) run cheaply enough to gate merge on every retrieval/chat PR, (2) run
expensively enough at least once a day to catch regressions only a real
LLM would surface, and (3) be regression-tested itself so a bug in the
runner can't hide a bug in retrieval.

## Decision Drivers

- The merge gate has to be fast and free to run on every PR — no real
  Anthropic / OpenAI calls in the critical path of CI.
- A real-LLM run is still required so we catch behavioural drift in
  Claude's citation discipline.
- The harness reuses existing primitives (`searchChunks`, the chat SSE
  route, citation extraction) rather than re-implementing them; otherwise
  the scoring would drift from what production actually does.
- A future Tier 2/3 may add ranking-quality metrics (NDCG, MRR) — the
  data shapes should leave room.

## Considered Options

### Scoring metrics

- **A1. citation_precision@k + citation_recall@k + answer_contains**
  (chosen). Three single-dimension scalars, easy to threshold; precision is
  the REQ-1.5.3 bar; recall surfaces retrieval misses; answer_contains
  catches LLM "didn't actually answer" failures that pure citation metrics
  miss.
- A2. Add NDCG / MRR. Defer to Tier 2 — adds noise without a strong
  signal in Tier 1's narrow corpus.
- A3. LLM-as-judge for answer quality. Expensive, non-deterministic, and
  the judge becomes the test surface. Tier 3 maybe.

### Wire-up for CI

- **B1. Mock LLM on every PR + real LLM nightly** (chosen). PR-time runs
  use canned transcripts from
  `packages/eval/fixtures/mock-transcripts.json` and exercise the
  metrics + runner; the harness's own regression test runs in the same
  package's vitest suite. The nightly cron uses real OpenAI + Anthropic
  against a deployed preview.
- B2. Real LLM on every PR. Cost + latency + flakiness make it a poor fit
  for a merge gate.
- B3. Mock-only. Misses LLM behavioural drift.

### Fixture corpus

- **C1. Synthetic text fixtures (3 short documents) shipped in
  `packages/eval/fixtures/`** (chosen). The corpus is content the
  harness owns; we can extend it without copyright concerns and keep
  questions stable across runs.
- C2. Use real third-party PDFs. License headaches, larger repo, and the
  marginal value (proving PDF extraction works) is already covered by the
  chunk #11 / #12 integration tests.

### Symbolic chunk ids

- **D1. Golden file references chunks by symbolic slug; live runner maps
  slug → UUID at ingestion time** (chosen). Chunk UUIDs are minted by the
  database and unstable across runs. The slug indirection lets the same
  golden file drive both mock and live modes.
- D2. Inline UUIDs in the golden file. Brittle; would need a re-write
  after every nightly re-ingest.

## Decision Outcome

We ship `@document-chat/eval` (library) + `apps/eval-cli` (thin runner)
+ `.github/workflows/eval.yml`:

- The library is pure (no Supabase, no Anthropic). It exposes
  `runEval(client, golden)`, the three metric functions, a
  `loadGolden(path)` parser, and a `makeMockClient(transcripts)` helper.
- `apps/eval-cli` has two modes:
  - `--mock` reads `mock-transcripts.json` and runs the same scoring loop
    that CI uses. No env vars, no network. Exits 0 on pass.
  - default (live) hits a deployed API base URL using a service-role
    Supabase session, parses the SSE stream produced by the chat handler,
    and remaps real chunk UUIDs to slugs via a seeder-written map file.
- `.github/workflows/eval.yml`:
  - `eval-mock` runs on every PR + push to main, calls
    `pnpm --filter eval-cli run start -- --mock`, and is marked required
    in branch protection (the deploy chunk wires the protection rule).
  - `eval-live` runs nightly on a cron + on workflow_dispatch, against a
    deployed preview, with a hard 5-minute timeout per case (max
    20 cases × 5 min = 100 min walltime ceiling).

### Pass criteria

A case passes iff all three metrics meet the threshold (default 0.9).
A run passes iff `passRate ≥ threshold`. CI fails on non-zero exit.

### Consequences

- Good: PRs cannot regress the citation contract without a red check.
- Good: the harness is the API contract, not a scattered set of asserts.
- Good: mock mode is fast (sub-second) and deterministic.
- Bad: mock transcripts have to be hand-maintained when the corpus or
  golden set changes — drift here means a green mock run can mask a
  retrieval bug. The runner's self-test (`runner.test.ts`) at least
  pins the harness logic so divergence is a transcript problem, not a
  runner one.
- Bad: live mode depends on a deployed preview being healthy. The
  workflow fails loud if the preview is down — that's intentional.

## Pros and Cons of the Options

### A1. precision + recall + answer_contains

- Pro: three independent failure axes; one threshold per axis
- Pro: precision matches REQ-1.5.3's wording exactly
- Con: answer_contains is a substring assertion, sensitive to phrasing —
  mitigated by accepting multiple substring options per case

### A2. NDCG / MRR

- Pro: industry-standard ranking metrics
- Con: needs a per-chunk relevance label, which the golden file does not
  carry today — Tier 2 work

### B1. Mock PR + real nightly

- Pro: keeps the merge gate free and fast; catches drift daily
- Con: a behavioural regression escapes for up to ~24h before the
  nightly catches it. Acceptable for a Tier 1 starter.

### B2. Real every PR

- Pro: shortest catch latency
- Con: cost + flakiness; gates merges on a third-party SLO

### C1. Synthetic owned corpus

- Pro: no licensing concerns; questions stay stable; small repo footprint
- Con: synthetic corpora can't catch real-world surprises — mitigated by
  the nightly real-LLM run + manual auditing on real docs in Tier 2

### D1. Slug indirection

- Pro: golden file is portable across re-ingests
- Con: requires a seed-time map file in live mode

## Links

- [REQ-1.5.3 — Citation precision target](../../requirements.md#req-153--citation-precision-target)
- [REQ-1.5.4 — No hallucinated citations](../../requirements.md#req-154--no-hallucinated-citations)
- [ADR-0006 — Embeddings + retrieval](./0006-embeddings-and-retrieval.md)
- [ADR-0007 — Chat streaming](./0007-chat-streaming.md)
