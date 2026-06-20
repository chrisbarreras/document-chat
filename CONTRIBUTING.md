# Contributing

Thanks for your interest. This is the public Apache 2.0 starter for a
document Q&A system. We aren't actively soliciting contributions, but if
you've got a fix or a feature, here's how to land it.

## License

All contributions are licensed under [Apache 2.0](./LICENSE) — the same license
as the project (inbound = outbound). Opening a PR means you agree your changes
are provided under that license. No CLA or DCO sign-off is required.

## Conventional commits

Use [Conventional Commits](https://www.conventionalcommits.org/) prefixes:

- `feat:` — new feature
- `fix:` — bug fix
- `chore:` — tooling, build, or maintenance
- `docs:` — documentation only
- `test:` — adding or updating tests
- `refactor:` — code change that doesn't fix a bug or add a feature
- `ci:` — CI configuration

Scopes follow the type when useful: `feat(web): GET /health`.

## Test-first

Every behavior starts with a failing test (see `implementation.md`). A PR
that adds code without tests will be sent back. The expected pattern in
small features is a **red** commit (failing test) followed by a **green**
commit (implementation). Squash-merge collapses the pair for `main`.

## Pull request workflow

1. Create a feature branch
2. Make changes — small, conventional commits
3. Open a PR with a filled-out test plan
4. CI runs lint, typecheck, contract regen, vitest, playwright, build, and the
   eval gate
5. Green PRs auto-merge (squash) to `main` — no review required

## Local setup

```sh
nvm use                                              # picks up .nvmrc
corepack enable && corepack prepare pnpm@9.15.0 --activate
pnpm install
pnpm --filter @document-chat/contracts run generate  # should produce zero diff
pnpm test
pnpm --filter web run dev                            # http://localhost:3000
```

## Code style

ESLint + Prettier + TypeScript strict. Apache 2.0 SPDX header
(`// SPDX-License-Identifier: Apache-2.0`) on every `.ts`, `.tsx`, and
`.mjs` source file in `apps/`, `packages/`, and `scripts/`. The
`license:check` script in CI enforces this.

## Workspace package scopes

- Public packages: `@document-chat/<name>` (e.g.,
  `@document-chat/contracts`).
- The private fork uses `@document-knowledge-graph/<name>`.
- The Next.js app is unscoped (`web`).

## Reporting issues

GitHub Issues. No SLA — best-effort triage. Security issues should not be
filed publicly; email the maintainer instead.
