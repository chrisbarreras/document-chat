# ADR-0006: Embeddings model lock + retrieval via a Postgres RPC

- Status: accepted
- Date: 2026-06-08
- Deciders: @tombarreras, @chrisbarreras

## Context and Problem Statement

Tier 1 needs two related decisions: (1) which embedding model to lock to for
storage + retrieval, and (2) how to expose the pgvector kNN query. The
embedding model choice and the SQL surface are coupled — a future model swap
requires per-document reindexing and the SQL function signature is sensitive
to vector dimensionality.

## Decision Drivers

- Quality vs. cost on the Tier 1 portfolio set — we don't need 3072-dim
  precision to demo citations.
- Vector size dominates the chunks table footprint and the HNSW index size.
- pgvector's `<=>` (cosine distance) operator can't be expressed through the
  Supabase JS query builder; we need either raw SQL via `pg`, a Postgres
  function callable via `.rpc()`, or a view.
- RLS must hold end-to-end — a kNN query that bypasses RLS would leak chunks
  across workspaces (a Tier 2 concern in scope, but a Tier 1 bug too).
- The same embedding client serves both ingestion (write-time embed of every
  chunk) and retrieval (read-time embed of every query). Code-sharing avoids
  drift between the two.

## Considered Options

### Embedding model

- **A1. OpenAI `text-embedding-3-small`, 1536 dims** (chosen)
- A2. OpenAI `text-embedding-3-large`, 3072 dims
- A3. A self-hosted open-weights model (bge, nomic-embed)

### Retrieval surface

- **B1. SQL function via `.rpc('search_chunks', …)`** (chosen)
- B2. A SQL view (`chunks_with_score`) and a query-builder `.order(...)`
- B3. Direct Postgres via `pg` + raw SQL (bypasses Supabase entirely)
- B4. A dedicated vector DB (Pinecone, Qdrant)

## Decision Outcome

**Embeddings: A1 — `text-embedding-3-small`, 1536 dims, locked through Tier 3.**
The model is recorded on every row (`chunks.embedding_model`,
`documents.embedding_model`) so a future swap is per-doc, not flag-day.
The constant + the client live in `packages/retrieval/src/providers/openai.ts`
and are re-exported as `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `embedTexts`,
`embedQuery`. `apps/web` consumes the same client at ingestion *and* query
time.

**Retrieval: B1 — `public.search_chunks(workspace_id, query_embedding,
top_k)` RPC.** The function is `SECURITY INVOKER` with an empty `search_path`
(Supabase hardening guidance), so the caller's JWT context drives RLS on
every row read. Returns one row per chunk joined to its parent document,
with a cosine-similarity `score` column. The HNSW index on
`chunks(embedding)` (m=16, ef_construction=64 per architecture.md) is used
automatically when the `ORDER BY` clause uses `<=>`.

A thin `searchChunks(rpcClient, workspaceId, query, options)` helper in
`packages/retrieval/src/search.ts` wraps the RPC: embeds the query, calls
`.rpc()`, returns typed rows. The Supabase client is dependency-injected
(via an `RpcClient` interface that types just `{ rpc(...) }`), keeping
`packages/retrieval` decoupled from `@supabase/supabase-js`.

### Consequences

- Good: ingestion + retrieval share one embedding client; one bug to fix in
  one place.
- Good: RLS held end-to-end without an extra check at the route handler —
  the RPC's `security invoker` carries the caller's role.
- Good: the route handlers stay framework-thin (assemble args, call helper,
  shape the response).
- Good: dimensionality is a single number in three places (SQL column, HNSW
  index, `EMBEDDING_DIMENSIONS`); a future swap touches all three together.
- Bad: swapping models requires a migration that drops the column type,
  re-embeds every chunk, and rebuilds the HNSW index. Documented; not a
  surprise.
- Bad: PostgREST won't autogenerate a typed signature for the function, so
  `searchChunks` carries the column list by hand. Mitigated by an
  integration test that asserts the shape against real rows.

## Pros and Cons of the Options

### A1. `text-embedding-3-small`
- Pro: 8× cheaper than large; fast; widely-used baseline for retrieval evals
- Pro: 1536 dims is the pgvector "happy size" for HNSW
- Con: ceiling on retrieval quality vs. larger models; visible on harder evals

### A2. `text-embedding-3-large`
- Pro: best OpenAI embedding quality
- Con: 2× storage and index size, 8× cost, marginal portfolio-set win

### A3. Self-hosted (bge / nomic-embed)
- Pro: no per-token cost; on-prem-ready
- Con: an extra service to run for Tier 0/1; not justified yet

### B1. SQL function + RPC
- Pro: RLS-respecting via `security invoker`; uses the HNSW index
- Pro: one function call from the JS client; typed input/output
- Con: a new migration per signature change

### B2. SQL view + `.order(...)`
- Pro: query-builder ergonomics
- Con: PostgREST doesn't expose `<=>`; would need a precomputed similarity
  column. Stale on inserts.

### B3. Raw `pg` driver
- Pro: full SQL flexibility
- Con: bypasses the Supabase auth helper that propagates the JWT — RLS
  enforcement becomes manual; one more thing to get wrong

### B4. Dedicated vector DB
- Pro: best at scale
- Con: two stores to keep in sync; over-engineered for Tier 1's scale

## Links

- [REQ-1.1.4 — Embedding storage](../../requirements.md#req-114--embedding-storage)
- [REQ-1.3.4 — Retrieval filters by status](../../requirements.md#req-134--retrieval-filters-by-status)
- [REQ-1.4.2 — Vector-search retrieval](../../requirements.md#req-142--vector-search-retrieval)
- [ADR-0002 — Supabase bundle](./0002-supabase-bundle.md)
- [architecture.md — Embeddings + HNSW](../../architecture.md)
