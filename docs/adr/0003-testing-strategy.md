# ADR-0003: Layered testing strategy with local Supabase in CI

- Status: accepted
- Date: 2026-05-20
- Deciders: @tombarreras, @chrisbarreras

## Context and Problem Statement

We need functional/integration tests that exercise a real database (Postgres
+ Auth + Storage + RLS), not mocks, plus E2E that can run against real
deployments. The open question is **where integration tests get their
database in CI**: a throwaway local stack, or a shared hosted project. This
decision shapes CI secrets, cost, and test fidelity. See
[ADR-0002](./0002-supabase-bundle.md) for why the stack is Supabase.

## Decision Drivers

- Fidelity: integration tests should hit real Postgres + GoTrue, so RLS and
  Auth behavior match production (the Tier 2 multi-tenant story builds on
  Postgres RLS, not app-layer filtering).
- No committed secrets: secret scanning (gitleaks) runs on every push; we
  don't want service-role keys in the repo or even as long-lived CI secrets.
- Cost: the team is two people on free tiers.
- Parity with local dev: `supabase start` already gives developers the full
  stack; CI should use the same thing.

## Considered Options

- **A. Local Supabase via the CLI, in dev and CI** (chosen)
- B. A hosted Supabase "test" project shared by CI
- C. Mock `@supabase/supabase-js`

## Decision Outcome

Chosen: **A — local Supabase via the CLI**, both locally and in CI. CI installs
the CLI (`supabase/setup-cli`), runs `supabase start` on the Ubuntu runner
(Docker is preinstalled), derives the URL + keys at runtime via
`supabase status -o env`, runs the integration tests, then `supabase stop`.

### Consequences

- Good: real Postgres + GoTrue parity; RLS and Auth behave as in production.
- Good: zero committed secrets and zero long-lived CI secrets — the local
  stack's keys are derived at runtime, so gitleaks stays clean.
- Good: free; each run gets a fresh, fully-migrated database (no shared-state
  cleanup).
- Good: identical to the local developer flow (`pnpm db:start`).
- Bad: integration tests require Docker; that's a heavier prerequisite than
  Tier 0 (which needs neither Docker nor Supabase).
- Bad: ~2–3 minutes added to CI for the Docker stack boot. Mitigated by
  running the `integration` job in parallel with `build`.

## Pros and Cons of the Options

### A. Local Supabase via CLI
- Pro: real services, no secrets, free, dev/CI parity
- Con: Docker dependency; slower than mocks

### B. Hosted test project
- Pro: no Docker; closest to the real cloud environment
- Con: costs money; shared state needs careful per-run teardown; requires
  storing service-role keys as CI secrets (scanning/rotation burden)

### C. Mock supabase-js
- Pro: fastest; no infrastructure
- Con: no real RLS/Auth behavior — exactly the thing integration tests exist
  to verify; mocks drift from reality

## Links

- [ADR-0002: Supabase bundle](./0002-supabase-bundle.md)
- [docs/testing.md](../testing.md)
