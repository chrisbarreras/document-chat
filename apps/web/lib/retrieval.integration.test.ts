// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import {
  EMBEDDING_DIMENSIONS,
  searchChunks,
  type RpcClient,
  type SearchResultRow,
} from '@document-chat/retrieval';

// Requires a running local Supabase stack (see docs/testing.md). Embeddings
// are deterministic stubs so the test does not need a real OpenAI key; the
// goal is to pin down kNN ordering, retired-doc exclusion, and RLS isolation
// against the real `search_chunks` SQL function + HNSW index.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = 'Password123!';

function makeClient(key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
  });
}

async function signedInClient(admin: SupabaseClient, email: string): Promise<SupabaseClient> {
  const { error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  expect(error).toBeNull();
  const client = makeClient(anonKey);
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  expect(signInErr).toBeNull();
  return client;
}

/**
 * Stub embedder that returns a deterministic vector for known phrases. Crafted
 * so the cosine similarity ordering is predictable: the query vector is exactly
 * `chunkVector(0)`, so the "nearest" chunk is the one stored with seed 0.
 */
function chunkVector(seed: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === seed ? 1 : 0));
}
function pgVector(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

/**
 * Wrap a SupabaseClient so it satisfies the retrieval package's RpcClient
 * interface and embeds a stub vector for the test's known query.
 */
function rpcAdapter(client: SupabaseClient): RpcClient {
  return {
    rpc: (fn, args) =>
      client.rpc(fn, args) as unknown as Promise<{
        data: SearchResultRow[] | null;
        error: { message: string } | null;
      }>,
  };
}

/**
 * Use searchChunks with the inline embed stub that returns chunkVector(0)
 * for any query. Bypasses the OpenAI fetch.
 */
async function search(
  client: SupabaseClient,
  workspaceId: string,
  topK = 8,
): Promise<SearchResultRow[]> {
  return searchChunks(rpcAdapter(client), workspaceId, 'query', {
    topK,
    embed: {
      apiKey: 'stub',
      fetch: (async () =>
        new Response(
          JSON.stringify({ data: [{ index: 0, embedding: chunkVector(0) }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )) as unknown as typeof fetch,
    },
  });
}

async function seedDocument(
  admin: SupabaseClient,
  workspaceId: string,
  userId: string,
  options: { title: string; status: 'current' | 'retired'; chunks: Array<{ seed: number; text: string }> },
): Promise<string> {
  const docInsert = await admin
    .from('documents')
    .insert({
      workspace_id: workspaceId,
      title: options.title,
      version: '1.0',
      status: options.status,
      size_bytes: 1024,
      page_count: 1,
      content_type: 'application/pdf',
      storage_object_key: `${workspaceId}/${crypto.randomUUID()}.pdf`,
      embedding_model: 'text-embedding-3-small',
      uploaded_by: userId,
      ingestion_state: 'ready',
    })
    .select('id')
    .single();
  expect(docInsert.error).toBeNull();
  const documentId = (docInsert.data as { id: string }).id;

  const chunkRows = options.chunks.map((c, i) => ({
    document_id: documentId,
    index: i,
    text: c.text,
    token_count: 10,
    embedding_model: 'text-embedding-3-small',
    page_number: 1,
    char_start: i * 100,
    char_end: i * 100 + 50,
    embedding: pgVector(chunkVector(c.seed)),
  }));
  const chunkInsert = await admin.from('chunks').insert(chunkRows);
  expect(chunkInsert.error).toBeNull();
  return documentId;
}

describe('retrieval (integration)', () => {
  it('returns chunks in cosine-similarity order via the search_chunks RPC', async () => {
    const admin = makeClient(serviceKey);
    const client = await signedInClient(admin, `r-${crypto.randomUUID()}@example.com`);
    const { data: ws } = await client.from('workspaces').select('id').single();
    const { data: u } = await client.auth.getUser();

    await seedDocument(admin, ws!.id, u.user!.id, {
      title: 'docA',
      status: 'current',
      chunks: [
        { seed: 0, text: 'nearest' },
        { seed: 7, text: 'middle' },
        { seed: 12, text: 'farther' },
      ],
    });

    const results = await search(client, ws!.id);
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results[0]?.text).toBe('nearest');
    // Scores are 1 - cosine_distance; nearest > farther.
    expect(results[0]!.score).toBeGreaterThan(results[results.length - 1]!.score);
  });

  it('excludes chunks from retired documents', async () => {
    const admin = makeClient(serviceKey);
    const client = await signedInClient(admin, `x-${crypto.randomUUID()}@example.com`);
    const { data: ws } = await client.from('workspaces').select('id').single();
    const { data: u } = await client.auth.getUser();

    await seedDocument(admin, ws!.id, u.user!.id, {
      title: 'current-doc',
      status: 'current',
      chunks: [{ seed: 5, text: 'current-chunk' }],
    });
    await seedDocument(admin, ws!.id, u.user!.id, {
      title: 'retired-doc',
      status: 'retired',
      chunks: [{ seed: 0, text: 'retired-chunk' }], // closer to the query vector
    });

    const results = await search(client, ws!.id);
    expect(results.map((r) => r.text)).not.toContain('retired-chunk');
    expect(results.map((r) => r.text)).toContain('current-chunk');
  });

  it('denies cross-workspace reads (RLS)', async () => {
    const admin = makeClient(serviceKey);
    const clientA = await signedInClient(admin, `a-${crypto.randomUUID()}@example.com`);
    const clientB = await signedInClient(admin, `b-${crypto.randomUUID()}@example.com`);
    const { data: wsA } = await clientA.from('workspaces').select('id').single();
    // B is only used to prove RLS denial; we never query their workspace.
    const { data: userA } = await clientA.auth.getUser();

    await seedDocument(admin, wsA!.id, userA.user!.id, {
      title: 'private',
      status: 'current',
      chunks: [{ seed: 0, text: 'private-chunk' }],
    });

    // B asks for chunks in A's workspace. RLS prevents the function from
    // seeing A's chunks under B's session, so results are empty.
    const results = await search(clientB, wsA!.id);
    expect(results).toEqual([]);
  });
});
