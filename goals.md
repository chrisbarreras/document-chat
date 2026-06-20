# Business Goals & Project Structure

> A production-grade document Q&A system with traceable citations,
> document-lifecycle awareness, and a knowledge-graph layer for provenance and
> truth-maintenance — built incrementally by a two-person team across **two
> repos**: an open-source portfolio starter (Apache 2.0) and a private
> commercial product derived from it.

## Primary goals

1. Ship an **open-source portfolio starter (Apache 2.0)** — Tiers 0–1 — that
   stands alone as a credible, deployable, forkable document Q&A system with
   citations and an eval harness.
2. Ship a **private commercial product** — Tiers 2–4 — derived from the
   public starter, adding multi-tenancy, billing, document lifecycle, and the
   knowledge-graph layer.
3. Establish disciplined engineering practices from day 1 — API-first,
   test-first, CI on every push — so quality scales with the codebase.
4. Build incrementally: each tier is independently shippable and delivers
   standalone value. No tier blocks on a later tier's design.

## Secondary goals

- The public starter is the Upwork credibility asset and the on-ramp for any
  community adoption that might bring inbound leads.
- Identify a pilot customer for commercialization (during/after Tier 2).
- Build reusable IP (eval harnesses, retrieval primitives, KG modules) that
  compound across client engagements; share what aids adoption, retain the
  commercially-differentiating pieces in private.

## Non-goals

- Hand-rolling infrastructure that managed services solve cheaply.
- Premature multi-provider / multi-cloud abstractions.
- Building a UI framework — use shadcn/ui or similar and move on.
- Microservices. Modular monorepo, single deployable, until scale demands otherwise.

---

## Project structure: public starter + private commercial

### Two repositories

| Repo | License | Scope | Audience |
|---|---|---|---|
| `knowledge-graph-starter` (public) | **Apache 2.0** | Tiers 0–1 | Portfolio, community, Upwork credibility |
| `knowledge-graph` (private) | Proprietary, all rights reserved | Tiers 2–4, plus the public starter as its base | Paying customers, internal team |

### What lives where

**Public starter (Apache 2.0):**

- Foundation: monorepo scaffold, OpenAPI contracts, CI pipeline
- Auth + single-user workspace
- Document upload + async ingestion (extract / chunk / embed)
- Citation-aware chat
- Basic document metadata fields (`title`, `version`, `status`, `effective_date`) — stored, but not the full lifecycle state machine
- Eval harness with a small illustrative golden Q&A set
- Deployable demo, README, architecture diagram

**Private commercial (proprietary):**

- Multi-tenant + RLS + permission-aware retrieval
- Stripe Billing, usage metering, admin dashboard
- Audit logs
- Full document-lifecycle state machine + supersession + time-travel queries
- Knowledge-graph layer (Phase 4a triples-in-Postgres → Phase 4b SPARQL)
- Customer-specific connectors
- Production eval extensions (lifecycle-aware metrics, customer-specific golden sets)

### npm package scopes

Workspace packages publish under deliberate scopes that are **independent of
the GitHub repo names**, so either repo can be renamed without churning
import paths.

- Public starter packages: `@document-chat/<name>` — e.g.,
  `@document-chat/contracts`, `@document-chat/eval`,
  `@document-chat/retrieval`, `@document-chat/logging`.
- Private fork packages: `@document-knowledge-graph/<name>` — e.g.,
  `@document-knowledge-graph/lifecycle`,
  `@document-knowledge-graph/billing`, `@document-knowledge-graph/kg`.
- The Next.js app itself (`apps/web`) is unscoped (`web`).

### Why Apache 2.0 (and not AGPL / BSL)

Apache 2.0 is the default permissive license for portfolio projects that we
want potential clients to **read, fork, and adopt** without legal friction.
It includes a patent grant — important for B2B credibility — and doesn't
trigger copyleft obligations that scare enterprise legal teams.

Tradeoff: a competitor *can* fork the public starter and offer a SaaS. We
accept this because (a) the starter is intentionally a *starter*, not the
product, and (b) the commercial moat is in Tiers 2–4 (lifecycle, KG,
provenance), which stay private. If a competitor builds a meaningful product
on the public starter, that's a market signal we'd want anyway.

If we ever want to prevent SaaS forking later, **BSL** (Business Source
License — Sentry, CockroachDB pattern) is the contemporary alternative.
We'd switch only if a concrete competitive threat appears.

### Contributor policy (public repo)

- **CONTRIBUTING.md** explaining how to propose changes.
- **Inbound = outbound licensing**: contributions are accepted under Apache 2.0
  (no CLA or DCO sign-off). The starter isn't soliciting contributions, so the
  lighter norm is sufficient; revisit if that changes.
- **Code of Conduct** (standard Contributor Covenant).
- **Issue templates + PR templates** matching our Definition-of-Done.
- We're **not** soliciting contributions actively — the starter is a
  portfolio piece, not a community project. But we make it easy if someone
  shows up.

---

## Business risks

| Risk | Mitigation |
|---|---|
| Competitor forks the public starter into a competing SaaS | Accepted risk under Apache 2.0; commercial moat is in private Tiers 2–4 (lifecycle, KG, provenance). Re-evaluate license (BSL) only if a concrete threat appears |
| Public contributions create licensing ambiguity | Inbound = outbound under Apache 2.0 (CONTRIBUTING.md is explicit about commercial use); not actively soliciting contributions, so exposure is minimal |
| Commercially-sensitive code accidentally pushed to public repo | Private features developed only in the private repo; pre-commit hook scans for known commercial package names; PR template checklist includes "is this in the right repo?" |
| OSS support burden distracts from commercial work | Issue template sets expectations (no SLA, best-effort triage); cap triage time |
| Vendor lock-in (Supabase, Vercel) | Business logic lives in `packages/`, not in framework-specific code; ADR before adopting any new vendor |
| LLM provider risk (pricing, quality, availability) | Provider abstraction in `packages/retrieval`; eval set lets us measure quality before switching |
| Cost surprises (LLM, embeddings) | Per-workspace usage tracking from Tier 2; budget alerts in CI; cheaper embedding model by default |

---

## Out-of-scope topics (parking lot)

Things we've considered but explicitly deferred. Capture here so they don't
clutter the active plan.

- Mobile clients — deferred until after Tiers 1–4. Approach when revisited:
  **PWA → Capacitor → React Native** (cost order), reusing the API-first contract
  and generated client. See implementation.md, "Beyond the tiers."
- Voice interface
- Multi-language support
- On-prem deployment automation
- Fine-tuning custom models
- Real-time collaboration on chats
- White-labeling

---

## See also

- [architecture.md](./architecture.md) — technology choices, repo structure, system shape
- [implementation.md](./implementation.md) — tiers, working agreements, execution plan
