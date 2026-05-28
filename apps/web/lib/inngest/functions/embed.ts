// SPDX-License-Identifier: Apache-2.0
//
// Pure embedding step — feed in the chunked text, write embedding rows, drive
// the documents row through `chunking -> embedding -> ready` (or `failed`).
// No SDK imports so unit tests can exercise the state machine without a real
// embeddings client or Supabase.
import type { TextChunk } from '@document-chat/retrieval';
import { EMBEDDING_MODEL } from '../../embeddings/openai';
import type { NewChunkRow } from '../storage';

/**
 * Dependencies for the pure embedding routine.
 */
export interface EmbeddingDeps {
  embed: (inputs: string[]) => Promise<number[][]>;
  /** Idempotent: deletes prior chunks before inserting. */
  storeChunks: (documentId: string, rows: NewChunkRow[]) => Promise<void>;
  setState: (documentId: string, patch: Record<string, unknown>) => Promise<void>;
}

/** pgvector accepts a `[v1,v2,...]` string via PostgREST. */
function toPgVector(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

/**
 * Drive a document from `chunking` through `embedding` to `ready`. Pure with
 * respect to its `deps`. On any thrown error, marks the row `failed` and
 * rethrows so Inngest applies its retry policy.
 *
 * Idempotent on retry: `storeChunks` deletes prior chunks before inserting,
 * so a partial previous run leaves no orphans.
 *
 * Returns the inserted row count so the Inngest step result is informative
 * in the dashboard.
 */
export async function runEmbedding(
  deps: EmbeddingDeps,
  documentId: string,
  chunks: TextChunk[],
): Promise<{ inserted: number }> {
  try {
    await deps.setState(documentId, { ingestion_state: 'embedding', ingestion_error: null });

    if (chunks.length === 0) {
      // Edge case: empty document. Reach `ready` with zero chunks so the
      // row state machine still terminates rather than wedging at
      // `embedding` forever.
      await deps.storeChunks(documentId, []);
      await deps.setState(documentId, { ingestion_state: 'ready' });
      return { inserted: 0 };
    }

    const vectors = await deps.embed(chunks.map((c) => c.text));
    if (vectors.length !== chunks.length) {
      throw new Error(
        `embedding count mismatch: expected ${chunks.length}, got ${vectors.length}`,
      );
    }

    const rows: NewChunkRow[] = chunks.map((c, i) => ({
      document_id: documentId,
      index: c.index,
      text: c.text,
      token_count: c.tokenCount,
      embedding_model: EMBEDDING_MODEL,
      page_number: c.pageNumber,
      char_start: c.charStart,
      char_end: c.charEnd,
      embedding: toPgVector(vectors[i]!),
    }));

    await deps.storeChunks(documentId, rows);
    await deps.setState(documentId, { ingestion_state: 'ready' });
    return { inserted: rows.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.setState(documentId, {
      ingestion_state: 'failed',
      ingestion_error: message,
    });
    throw err;
  }
}
