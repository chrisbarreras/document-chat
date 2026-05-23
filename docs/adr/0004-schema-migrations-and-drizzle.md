# ADR-0004: Supabase migrations as the single apply pipeline; Drizzle for schema + queries

- Status: accepted
- Date: 2026-05-23
- Deciders: @tombarreras, @chrisbarreras

## Context and Problem Statement

Tier 1 introduces the first real tables (workspaces, documents, chunks) with
row-level security and an auth trigger. We use Supabase (see
[ADR-0002](./0002-supabase-bundle.md)) and Drizzle is the chosen ORM
([architecture.md](../../architecture.md)). The open question is **how
migrations are authored and applied** when both drizzle-kit and the Supabase
CLI can manage SQL — and we already have a Supabase migration
(`supabase/migrations/…_init_extensions.sql`) plus a CI `integration` job that
applies migrations via `supabase db reset`.

## Decision Drivers

- One apply pipeline — two migration runners (drizzle-kit + Supabase CLI) means
  ordering and state-tracking across systems, which is fragile, especially in
  CI.
- RLS, triggers, and grants are first-class here and are most reviewable
  alongside the tables they protect.
- RLS-scoped reads must run **as the user** (JWT → `auth.uid()`), which the
  Supabase client does natively; a direct Drizzle/postgres connection runs as a
  privileged role and bypasses RLS unless impersonation is wired.
- Keep the typed-schema benefits of Drizzle.

## Considered Options

- **A. Supabase SQL migrations are authoritative; Drizzle is the typed
  schema + (server-side) query layer** (chosen)
- B. drizzle-kit generates table migrations; Supabase CLI owns RLS/triggers
  (the literal split in architecture.md)
- C. Defer Drizzle; pure Supabase SQL + Supabase-client queries only

## Decision Outcome

Chosen: **A**. Tables, RLS, triggers, and grants are authored as hand-written
SQL in `supabase/migrations/` — a single pipeline applied by `supabase db
reset` locally and in CI. The Drizzle schema (`apps/web/lib/db/schema.ts`) is
the TypeScript source of truth for table shape and inferred row types, used for
service-side queries as they arrive (ingestion, retrieval). RLS-scoped user
reads (e.g. `GET /api/me`) use the Supabase client, which carries the user's
JWT so `auth.uid()` policies apply.

### Consequences

- Good: one migration pipeline; no cross-runner ordering or state.
- Good: RLS + triggers + tables reviewed together in one SQL file per feature.
- Good: real RLS fidelity in tests (the `integration` job runs them).
- Good: Drizzle still gives typed rows and a query builder for privileged
  server-side paths later.
- Bad: the Drizzle schema is kept in sync with the SQL **by hand**. Mitigation:
  `drizzle-kit` is installed so `drizzle-kit generate` can diff the schema
  against a database in review; the integration tests fail if the shapes drift
  in a way that breaks queries.
- Bad: Drizzle's own migration folder/state is intentionally unused, which may
  surprise contributors expecting `drizzle-kit migrate`. Documented here and in
  `docs/testing.md`.

Note: the Drizzle schema currently lives in `apps/web` because that's its only
consumer. It moves to a shared `packages/db` when `packages/retrieval` /
`apps/eval-cli` need it.

## Pros and Cons of the Options

### A. Supabase migrations authoritative + Drizzle for schema/queries
- Pro: single pipeline; RLS-with-tables; real-RLS tests; typed rows
- Con: manual schema↔SQL sync

### B. drizzle-kit migrations + Supabase CLI for RLS
- Pro: closest to architecture.md as written; schema drives table DDL
- Con: two runners to apply and order; more CI wiring and failure modes
- Con: RLS still hand-written, so the split doesn't remove SQL anyway

### C. Defer Drizzle
- Pro: least tooling now
- Con: postpones the ORM decision and means retrofitting typed queries later

## Links

- [ADR-0002: Supabase bundle](./0002-supabase-bundle.md)
- [ADR-0003: testing strategy](./0003-testing-strategy.md)
- [architecture.md](../../architecture.md)
