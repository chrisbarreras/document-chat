// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi } from 'vitest';
import { embedQuery, embedTexts, EMBEDDING_DIMENSIONS } from './openai';

function makeVector(seed: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => seed + i / 10000);
}

function okResponse(start: number, count: number): Response {
  const data = Array.from({ length: count }, (_, i) => ({
    index: i,
    embedding: makeVector(start + i),
  }));
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('embedTexts', () => {
  it('returns an empty result for empty input without a network call', async () => {
    const fetchImpl = vi.fn();
    const out = await embedTexts([], { fetch: fetchImpl as unknown as typeof fetch, apiKey: 'k' });
    expect(out).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('batches over the configured batch size and preserves input order', async () => {
    let nextSeed = 0;
    // The stub honours the actual batch size sent on each call — last batch
    // may be smaller than `batchSize`. With 5 inputs at batchSize=2 that's
    // [2, 2, 1].
    const fetchImpl = vi.fn(async (_url, init: RequestInit | undefined) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      const count = body.input.length;
      const start = nextSeed;
      nextSeed += count;
      return okResponse(start, count);
    });
    const out = await embedTexts(['a', 'b', 'c', 'd', 'e'], {
      fetch: fetchImpl as unknown as typeof fetch,
      apiKey: 'k',
      batchSize: 2,
    });
    expect(out).toHaveLength(5);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(out[0]?.[0]).toBe(0);
    expect(out[2]?.[0]).toBe(2);
    expect(out[4]?.[0]).toBe(4);
  });

  it('re-sorts an out-of-order batch by index before placement', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: makeVector(101) },
            { index: 0, embedding: makeVector(100) },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const out = await embedTexts(['a', 'b'], {
      fetch: fetchImpl as unknown as typeof fetch,
      apiKey: 'k',
    });
    expect(out[0]?.[0]).toBe(100);
    expect(out[1]?.[0]).toBe(101);
  });

  it('throws a typed error including the OpenAI message on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 }),
    );
    await expect(
      embedTexts(['a'], { fetch: fetchImpl as unknown as typeof fetch, apiKey: 'k' }),
    ).rejects.toThrow(/rate limited/);
  });

  it('throws when neither apiKey option nor OPENAI_API_KEY env is set', async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await expect(embedTexts(['a'])).rejects.toThrow(/OPENAI_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });
});

describe('embedQuery', () => {
  it('returns the single vector for a one-input batch', async () => {
    const fetchImpl = vi.fn(async () => okResponse(0, 1));
    const vector = await embedQuery('a query', {
      fetch: fetchImpl as unknown as typeof fetch,
      apiKey: 'k',
    });
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
