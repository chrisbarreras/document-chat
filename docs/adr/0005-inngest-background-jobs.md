# ADR-0005: Inngest for asynchronous document ingestion

- Status: accepted
- Date: 2026-05-28
- Deciders: @tombarreras, @chrisbarreras

## Context and Problem Statement

Tier 1 requires asynchronous text extraction, chunking, and embedding for each
uploaded document (REQ-1.1.2): the upload response returns immediately with a
`pending` status, then a background pipeline drives the document through
`extracting → chunking → embedding → ready` (or `failed`). The pipeline must
survive a deploy (REQ-2.NF.2 also calls this out for Tier 2, but the foundation
lands here). [architecture.md](../../architecture.md) names Inngest as the
chosen orchestrator; this ADR records why and how it fits.

## Decision Drivers

- Durable background work that survives deploys, restarts, and step failures.
- Multi-step orchestration with built-in retries — extraction, chunking, and
  embedding are three sequenced steps with different failure modes.
- Local-dev parity: Tier 0's working agreement is "clone → working in <15 min";
  background jobs need to run without external dependencies in `pnpm dev`.
- Typed events end-to-end. Drift between event producer and handler is a
  known foot-gun in queue-based architectures.
- Avoid hand-rolling a worker fleet, a queue, or a state machine.

## Considered Options

- **A. Inngest** (chosen)
- B. A Postgres-backed queue (pg-boss / Graphile Worker) plus a Vercel
  background-function worker
- C. Vercel Queues (preview only at time of writing)
- D. Run extraction inline in the upload handler (no queue)

## Decision Outcome

Chosen: **A. Inngest**. It matches the constraints with the least bespoke
plumbing — durable steps with automatic retry, a typed `Inngest` client with
schema-validated `inngest.send(...)`, a single `/api/inngest` Next.js route
handler that registers every function, and a local dev server (`npx inngest-cli
dev`) that runs alongside `pnpm dev` and discovers functions over HTTP. The
event-driven shape also lets us add reprocess + ingestion-progress events
(chunks #17, #18 in [implementation.md](../../implementation.md)) without a
second piece of infrastructure.

### Consequences

- Good: durable, retried, observable steps without standing up workers,
  queues, or schedulers.
- Good: typed event payloads. The same `Inngest` client used to send is the
  type source for the function handler argument.
- Good: local dev story — Inngest dev server runs on a known port; the
  Next.js route handler at `/api/inngest` is the single registration surface.
- Good: aligns with [architecture.md](../../architecture.md)'s explicit
  Tier 1 callout.
- Bad: introduces a managed dependency. Mitigated by Inngest's free tier and
  by keeping function bodies thin enough to swap orchestrators later — each
  function calls into pure `packages/retrieval` / library code that is
  framework-agnostic.
- Bad: a second long-running dev process. Mitigated by colocating
  `inngest-cli dev` in the existing `pnpm dev:all` story.

## Pros and Cons of the Options

### A. Inngest
- Pro: durable steps + retries; typed events; managed UI + observability
- Pro: native Next.js handler; local dev server
- Pro: roadmap supports the SSE ingestion-events surface declared in OpenAPI
- Con: one more managed vendor; another dev process to launch

### B. Postgres-backed queue (pg-boss / Graphile Worker)
- Pro: no new vendor; uses the Supabase DB we already operate
- Con: must operate a worker process on Vercel (cron + background functions),
  build retry/backoff/visibility-timeout semantics, and a separate dev runner
- Con: no typed-event story — drift between sender and handler is on us

### C. Vercel Queues
- Pro: would be the lightest integration
- Con: preview at time of writing; not yet a Tier 1 production-ready option

### D. Inline extraction
- Pro: simplest implementation
- Con: violates REQ-1.1.2 (must not block the upload response); the upload
  body limit and serverless function timeout cap document size

## Links

- [REQ-1.1.2 — Asynchronous extraction](../../requirements.md#req-112--asynchronous-extraction)
- [architecture.md — Background jobs](../../architecture.md#technology-choices)
- [implementation.md — Tier 1 deliverables](../../implementation.md)
