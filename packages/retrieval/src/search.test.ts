// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi } from 'vitest';
import { searchChunks, type RpcClient, type SearchResultRow } from './search';
import { EMBEDDING_DIMENSIONS } from './providers/openai';

const WORKSPACE_ID = '00000000-0000-0000-0000-0000000000aa';

function fakeFetch(): typeof fetch {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            index: 0,
            embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i / 10000),
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  ) as unknown as typeof fetch;
}

function row(id: string, score: number): SearchResultRow {
  return {
    id,
    document_id: '11111111-1111-1111-1111-111111111111',
    document_title: 'Doc',
    document_version: '1.0',
    index: 0,
    text: 'chunk',
    token_count: 10,
    embedding_model: 'text-embedding-3-small',
    page_number: 1,
    char_start: 0,
    char_end: 5,
    section_path: null,
    score,
    created_at: '2026-06-08T00:00:00.000Z',
    updated_at: '2026-06-08T00:00:00.000Z',
  };
}

function rpcClient(data: SearchResultRow[] | null, error: { message: string } | null = null): RpcClient {
  return { rpc: vi.fn(async () => ({ data, error })) };
}

describe('searchChunks', () => {
  it('rejects empty queries before any network call', async () => {
    const client = rpcClient([]);
    await expect(
      searchChunks(client, WORKSPACE_ID, '   ', { embed: { fetch: fakeFetch(), apiKey: 'k' } }),
    ).rejects.toThrow(/non-empty/);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('embeds the query and calls search_chunks with workspace + clamped top_k', async () => {
    const client = rpcClient([row('c1', 0.9)]);
    await searchChunks(client, WORKSPACE_ID, 'hello world', {
      topK: 999,
      embed: { fetch: fakeFetch(), apiKey: 'k' },
    });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = vi.mocked(client.rpc).mock.calls[0]!;
    expect(fn).toBe('search_chunks');
    expect(args.p_workspace_id).toBe(WORKSPACE_ID);
    // Top-K is clamped to MAX_TOP_K (50).
    expect(args.p_top_k).toBe(50);
    // Vector is sent as the pgvector `[…]` literal so PostgREST accepts it.
    expect(String(args.p_query_embedding).startsWith('[')).toBe(true);
    expect(String(args.p_query_embedding).endsWith(']')).toBe(true);
  });

  it('defaults to topK=8 when not specified', async () => {
    const client = rpcClient([]);
    await searchChunks(client, WORKSPACE_ID, 'q', { embed: { fetch: fakeFetch(), apiKey: 'k' } });
    const args = vi.mocked(client.rpc).mock.calls[0]![1];
    expect(args.p_top_k).toBe(8);
  });

  it('returns the rows the RPC produced in order', async () => {
    const data = [row('c1', 0.9), row('c2', 0.7)];
    const client = rpcClient(data);
    const out = await searchChunks(client, WORKSPACE_ID, 'q', {
      embed: { fetch: fakeFetch(), apiKey: 'k' },
    });
    expect(out).toHaveLength(2);
    expect(out[0]?.id).toBe('c1');
    expect(out[1]?.id).toBe('c2');
  });

  it('throws when the RPC reports an error', async () => {
    const client = rpcClient(null, { message: 'oops' });
    await expect(
      searchChunks(client, WORKSPACE_ID, 'q', { embed: { fetch: fakeFetch(), apiKey: 'k' } }),
    ).rejects.toThrow(/oops/);
  });

  it('returns an empty array when the RPC returns null data', async () => {
    const client = rpcClient(null);
    const out = await searchChunks(client, WORKSPACE_ID, 'q', {
      embed: { fetch: fakeFetch(), apiKey: 'k' },
    });
    expect(out).toEqual([]);
  });
});
