// SPDX-License-Identifier: Apache-2.0
//
// Batched OpenAI embeddings client. Pure with respect to a pluggable `fetch`
// implementation so unit tests can exercise batching + retry without network
// access. Defaults to the global `fetch` injected by Node 20 / the Next.js
// runtime.

/** Public-facing identifier of the embedding model locked through Tier 3. */
export const EMBEDDING_MODEL = 'text-embedding-3-small';

/** Dimension of `text-embedding-3-small`. Must match the pgvector column. */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Maximum input strings per OpenAI embeddings request. OpenAI's own limit is
 * 2048; we stay well under it to keep individual requests small and retries
 * cheap. Override per-call for testing.
 */
export const DEFAULT_BATCH_SIZE = 64;

export interface EmbedOptions {
  /** Override the model. Tier 1 only ever passes the default. */
  model?: string;
  /** Override the batch size. Defaults to `DEFAULT_BATCH_SIZE`. */
  batchSize?: number;
  /** Inject a fetch (e.g. test stub). Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** API key override. Defaults to `process.env.OPENAI_API_KEY`. */
  apiKey?: string;
}

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

interface OpenAIErrorBody {
  error?: { message?: string };
}

/**
 * Embed `inputs` with `text-embedding-3-small` in batches. Returns one
 * 1536-dim vector per input, in input order. Throws on the first failed
 * batch — the Inngest step that wraps this call decides whether to retry.
 *
 * Empty inputs short-circuit to an empty result (no network call); callers
 * higher up should never embed an empty chunk, but defending here keeps the
 * primitive total.
 */
export async function embedTexts(
  inputs: string[],
  options: EmbedOptions = {},
): Promise<number[][]> {
  if (inputs.length === 0) return [];

  const model = options.model ?? EMBEDDING_MODEL;
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required to embed chunks');
  }

  const out: number[][] = new Array(inputs.length);
  for (let start = 0; start < inputs.length; start += batchSize) {
    const batch = inputs.slice(start, start + batchSize);
    const res = await fetchImpl('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: batch }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as OpenAIErrorBody;
      const detail = body.error?.message ?? `${res.status} ${res.statusText}`;
      throw new Error(`openai embeddings failed: ${detail}`);
    }

    const body = (await res.json()) as OpenAIEmbeddingResponse;
    // OpenAI returns vectors with the same `index` ordering as the input.
    // Defensively re-sort just in case so callers never see drift.
    body.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .forEach((row, i) => {
        out[start + i] = row.embedding;
      });
  }

  return out;
}
