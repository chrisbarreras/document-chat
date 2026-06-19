<!-- SPDX-License-Identifier: Apache-2.0 -->

# Integration-test plan: cover the DB stores

## Context

After the Tier 1/2 unit backfill (PR #26), `apps/web` logic coverage sits at **76%**. The remaining gap is the **database stores** — the modules that own all Supabase I/O — which the honest coverage report shows at 0–27%:

| Store | Coverage | Exported functions (count) |
|---|---|---|
| `lib/documents-store.ts` | 0% | mint/find/insert/list/get/update/delete (7) |
| `lib/chunks-store.ts` | 0% | listDocumentChunks, getChunkRow, fetchChunksForCitations (3) |
| `lib/ingestion-events-store.ts` | 27% | listIngestionEvents, getEventsSince (+ a tested mapper) |
| `lib/chats-store.ts` | 25% | list/insert/get/update/delete chats + messages + citations + persistAssistantMessage (11) |
| `lib/workspace.ts` | 0% | getCurrentWorkspace (1) |

These are **not unit-test targets** — they're thin wrappers around real Postgres/Storage queries and RLS policies. Mocking the Supabase client to unit-test them would assert against the mock, not the database. They must be covered by **integration tests against the local Supabase stack**.

## The core problem

There are already 11 `*.integration.test.ts` files, but **they re-implement the queries inline** rather than calling the store functions. Example — `lib/documents.integration.test.ts` does `clientA.from('documents').insert(...)` instead of `insertDocument(...)`. So the store code never executes under test, and coverage stays at 0%.

The reason is structural: every store function obtains its client internally —
- RLS-scoped queries call `await createSSRClient()` (`lib/supabase/server.ts`) — cookie-bound to the request.
- Privileged ops call `createAdminClient()` (`lib/supabase/admin.ts`) — service role.

Neither takes an injectable client, and `createSSRClient` needs Next's request-cookie context that doesn't exist in a Vitest process.

## Strategy

**Inject real authenticated clients via module mocks** — no source refactor. In each new integration test, mock the two factory modules to return *real* `@supabase/supabase-js` clients (a signed-in anon client for `createSSRClient`, a service client for `createAdminClient`), then call the **actual store functions** and assert against the DB.

```ts
// documents-store.integration.test.ts (sketch)
vi.mock('./supabase/server', () => ({ createSSRClient: vi.fn() }));
vi.mock('./supabase/admin', () => ({ createAdminClient: vi.fn() }));
import { createSSRClient } from './supabase/server';
import { createAdminClient } from './supabase/admin';
import { insertDocument, listDocuments, getDocumentRow } from './documents-store';

const alice = await signedInClient(admin, uniqueEmail());      // real RLS client
vi.mocked(createSSRClient).mockResolvedValue(alice);            // store runs as Alice
vi.mocked(createAdminClient).mockReturnValue(admin);

const row = await insertDocument({ workspaceId: wsA, /* ... */ });   // REAL store code runs
expect(row?.ingestion_state).toBe('pending');
```

Because the injected anon client is signed in, the store's real RLS queries run **as that user** — so the same tests double as RLS-isolation checks (Alice's `listDocuments()` must not return Bob's rows).

> Alternative considered: refactor stores to accept an optional `client` param (dependency injection). Cleaner long-term and avoids mocks, but it's a source change across ~22 functions and all call sites. The mock-factory approach gets the coverage now with zero production-code churn; DI can follow if the mocks get unwieldy. **Recommend mock-factory.**

## Shared helpers (do first)

Extract the duplicated setup (currently copy-pasted in every integration test) into `apps/web/test/integration-helpers.ts`:
- `adminClient()` / `anonClient()` — the `createClient` config (incl. the `ws` WebSocket shim already used).
- `signedInClient(admin, email)` — create user + sign in (lifted from `documents.integration.test.ts:22`).
- `uniqueEmail(prefix)` — `${prefix}-${crypto.randomUUID()}@example.com`.
- Seeders: `seedDocument(client, { wsId, userId, ... })`, `seedChunks(admin, docId, n)`, `seedChat(client, wsId)` — return inserted rows for assertions.

These run under the existing `vitest.integration.config.ts` (env via `.env.test`, `server-only` aliased) and the `pnpm test:integration` / `pnpm coverage` commands — no config changes needed.

## New test files & what each asserts

One `*.integration.test.ts` per store, each covering **happy path + RLS isolation + null/not-found returns**:

1. **`documents-store.integration.test.ts`**
   - `insertDocument` → row in `pending`; `getDocumentRow` round-trips; not-found → null.
   - `listDocuments` → ordering + cursor pagination (the offset/sentinel logic in `documents.ts`), `status`/`q` filters, `nextCursor` set when more rows exist.
   - `updateDocumentRow` (status/effective_date) and `deleteDocumentAndObject` (row gone + storage object removed).
   - `mintUploadUrl` / `findUploadedObject` → stage an object via `admin.storage.upload`, assert size/mimetype; missing object → null.
   - RLS: Bob cannot get/list/update/delete Alice's document.

2. **`chunks-store.integration.test.ts`**
   - Seed a document + chunk rows via admin (chunks carry a `vector` embedding column — insert deterministic dummy vectors).
   - `listDocumentChunks` pagination/order; `getChunkRow` + not-found null; `fetchChunksForCitations` resolves a set, marks missing ids unavailable.
   - RLS: chunks only visible within the owner's workspace.

3. **`ingestion-events-store.integration.test.ts`**
   - Seed events; `listIngestionEvents` order/paging; `getEventsSince` cursor (drives the SSE reprocess feed). (`toContractIngestionEvent` mapper already tested.)

4. **`chats-store.integration.test.ts`** (largest)
   - chats: insert/get/update/delete + list; messages: insert/get/list; citations: `getMessageCitations`, `getCitationsForMessages`.
   - `persistAssistantMessage` — the multi-row write (message + citations); verify both land and link correctly.
   - RLS isolation across all of the above.

5. **`workspace.integration.test.ts`** (extend existing) — call `getCurrentWorkspace()` itself (via injected client) so the function is covered, not just the auto-provision SQL.

## Risks / gotchas
- **Storage**: `mintUploadUrl`/`findUploadedObject` hit the `documents` bucket — stage/clean objects via the admin client; assert on `findUploadedObject` rather than fetching the signed URL.
- **Vectors**: chunk rows need a `vector` embedding value — insert fixed-length dummy arrays via admin; don't call a real embedding provider.
- **Isolation**: every test uses fresh `uniqueEmail()` users so runs don't collide; prefer per-test users over shared fixtures.
- **CI**: these run in the existing non-required `integration` job, which already feeds the report-only coverage from PR #25 — no workflow changes.

## Sequencing & rough effort
1. `integration-helpers.ts` + migrate `documents.integration.test.ts` to use it (proves the mock-injection pattern). ~0.5 day.
2. `documents-store` + `chunks-store` + `ingestion-events-store`. ~1 day.
3. `chats-store` (incl. `persistAssistantMessage`) + `workspace`. ~1 day.

## Expected outcome
Stores move from 0–27% toward 85%+, lifting `apps/web` combined coverage from ~76% into the high 80s, and — more importantly — the store query/RLS logic gains a real regression net. No production code changes; no new dependencies.
