// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi } from 'vitest';
import type { TextChunk } from '@document-chat/retrieval';
import { runEmbedding, type EmbeddingDeps } from './embed';

const DOCUMENT_ID = '22222222-2222-2222-2222-222222222222';
const VECTOR = Array.from({ length: 1536 }, (_, i) => i);

const sampleChunks: TextChunk[] = [
  { index: 0, text: 'first chunk', tokenCount: 10, charStart: 0, charEnd: 11, pageNumber: 1 },
  { index: 1, text: 'second chunk', tokenCount: 12, charStart: 12, charEnd: 24, pageNumber: 1 },
];

function makeDeps(overrides: Partial<EmbeddingDeps> = {}): EmbeddingDeps {
  return {
    embed: vi.fn().mockResolvedValue([VECTOR, VECTOR]),
    storeChunks: vi.fn().mockResolvedValue(undefined),
    setState: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('runEmbedding', () => {
  it('transitions embedding → ready and inserts one row per chunk', async () => {
    const deps = makeDeps();
    const result = await runEmbedding(deps, DOCUMENT_ID, sampleChunks);

    expect(result).toEqual({ inserted: 2 });
    expect(deps.embed).toHaveBeenCalledWith(['first chunk', 'second chunk']);
    expect(deps.setState).toHaveBeenNthCalledWith(1, DOCUMENT_ID, {
      ingestion_state: 'embedding',
      ingestion_error: null,
    });
    expect(deps.setState).toHaveBeenLastCalledWith(DOCUMENT_ID, { ingestion_state: 'ready' });

    const inserted = vi.mocked(deps.storeChunks).mock.calls[0]![1];
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toMatchObject({
      document_id: DOCUMENT_ID,
      index: 0,
      text: 'first chunk',
      token_count: 10,
      page_number: 1,
      embedding_model: 'text-embedding-3-small',
    });
    expect(inserted[0]?.embedding.startsWith('[')).toBe(true);
    expect(inserted[0]?.embedding.endsWith(']')).toBe(true);
  });

  it('reaches ready with zero rows for an empty chunk array (no embed call)', async () => {
    const deps = makeDeps();
    const result = await runEmbedding(deps, DOCUMENT_ID, []);

    expect(result).toEqual({ inserted: 0 });
    expect(deps.embed).not.toHaveBeenCalled();
    expect(deps.storeChunks).toHaveBeenCalledWith(DOCUMENT_ID, []);
    expect(deps.setState).toHaveBeenLastCalledWith(DOCUMENT_ID, { ingestion_state: 'ready' });
  });

  it('marks failed and rethrows on a count mismatch from the embeddings client', async () => {
    const deps = makeDeps({ embed: vi.fn().mockResolvedValue([VECTOR]) });
    await expect(runEmbedding(deps, DOCUMENT_ID, sampleChunks)).rejects.toThrow(/count mismatch/);
    expect(deps.setState).toHaveBeenLastCalledWith(DOCUMENT_ID, {
      ingestion_state: 'failed',
      ingestion_error: expect.stringContaining('count mismatch'),
    });
    expect(deps.storeChunks).not.toHaveBeenCalled();
  });

  it('marks failed and rethrows when the embed client throws', async () => {
    const deps = makeDeps({ embed: vi.fn().mockRejectedValue(new Error('openai down')) });
    await expect(runEmbedding(deps, DOCUMENT_ID, sampleChunks)).rejects.toThrow('openai down');
    expect(deps.setState).toHaveBeenLastCalledWith(DOCUMENT_ID, {
      ingestion_state: 'failed',
      ingestion_error: 'openai down',
    });
  });
});
