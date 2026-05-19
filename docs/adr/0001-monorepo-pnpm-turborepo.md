# ADR-0001: Use a pnpm + Turborepo monorepo

- Status: accepted
- Date: 2026-05-18
- Deciders: @tombarreras, @chrisbarreras

## Context and Problem Statement

We ship a public Apache 2.0 starter (Tiers 0-1) and a private commercial fork
(Tiers 2-4) from one codebase shape. Both forks share the chassis: a Next.js
app, an OpenAPI contract package, an eval harness, and retrieval primitives.
We need a workspace tool that supports multi-package development, fast
installs, and reusable build outputs.

## Decision Drivers

- Two-person team — minimize ceremony
- API-first: the OpenAPI spec and generated client must be importable across
  packages
- Public/private fork sync via `git merge upstream/main` — works only if the
  file shape is identical between repos
- Speed: install + CI feedback under 60 seconds for an incremental change
- Build cache reuse once `packages/contracts` codegen and `packages/eval`
  runners are wired

## Considered Options

- **pnpm + Turborepo** (chosen)
- npm workspaces + custom Makefile-style scripts
- Yarn 4 (Berry) + Nx
- Bun workspaces

## Decision Outcome

Chosen: **pnpm workspaces (9.x) + Turborepo (2.x)**.

### Consequences

- Good: pnpm catalogs centralize dep versions across workspaces; one source
  of truth for `next`, `react`, `vitest`, etc.
- Good: Turborepo's task graph + remote cache speed up CI as the project
  grows; Vercel's free-tier remote cache works out of the box.
- Good: industry-standard pairing in 2026; junior contributors find plenty
  of references.
- Good: hard-link content-addressable store keeps disk usage low across the
  two clones (public + private fork on the same dev machine).
- Bad: pnpm has occasional Windows path-length issues on deeply nested
  hoisted deps; mitigated by `node-linker=isolated` (the default).
- Bad: Turborepo v2 changed the config format from v1 (`pipeline` →
  `tasks`); older blog posts will mislead.

## Pros and Cons of the Options

### pnpm + Turborepo
- Pro: catalogs, hard-link store, fast CI
- Pro: Vercel + Next.js integration is first-class
- Con: occasional Windows path-length issues

### npm workspaces + custom scripts
- Pro: zero new tools to learn
- Con: no task-graph cache; slow as the repo grows
- Con: no catalog equivalent — dep drift across workspaces

### Yarn 4 + Nx
- Pro: powerful task graph, well-thought-out caching
- Con: Nx config overhead is high for a two-person team
- Con: Yarn Berry PnP can fight tooling that expects `node_modules`

### Bun workspaces
- Pro: blazingly fast install
- Con: ecosystem still catching up (Next.js, Vercel, Drizzle); too risky as
  the base of a multi-year project

## Links

- [Turborepo v2 migration notes](https://turbo.build/repo/docs/upgrading-to-v2)
- [pnpm catalogs](https://pnpm.io/catalogs)
