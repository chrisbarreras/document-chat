// SPDX-License-Identifier: Apache-2.0
// Database I/O for chunk reads + citation resolution. Both paths run with
// the cookie-bound (RLS-scoped) client — server-side ingestion writes
// through the admin client, but every user-facing read is enforced by RLS.
import { createSSRClient } from './supabase/server';
import { encodeCursor, decodeCursor } from './documents';
import type { ChunkRow, CitationDocumentMeta } from './chunks';

const CHUNK_COLUMNS =
  'id, document_id, index, text, token_count, embedding_model, ' +
  'page_number, char_start, char_end, section_path, created_at, updated_at';

export interface ListChunksParams {
  documentId: string;
  cursor?: string;
  limit: number;
}

/**
 * List chunks of a document in `index` order (RLS-scoped). Cursor pagination
 * mirrors the documents list — opaque offset, fine at single-workspace scale.
 */
export async function listDocumentChunks(
  params: ListChunksParams,
): Promise<{ items: ChunkRow[]; nextCursor: string | null }> {
  const supabase = await createSSRClient();
  const offset = decodeCursor(params.cursor);

  const { data, error } = await supabase
    .from('chunks')
    .select(CHUNK_COLUMNS)
    .eq('document_id', params.documentId)
    .order('index', { ascending: true })
    // Fetch one extra row to detect whether another page exists.
    .range(offset, offset + params.limit);

  if (error || !data) return { items: [], nextCursor: null };

  const rows = data as unknown as ChunkRow[];
  const hasMore = rows.length > params.limit;
  const items = hasMore ? rows.slice(0, params.limit) : rows;
  const nextCursor = hasMore ? encodeCursor(offset + params.limit) : null;
  return { items, nextCursor };
}

/**
 * Fetch a single chunk by id (RLS-scoped). Null if absent or not visible.
 */
export async function getChunkRow(id: string): Promise<ChunkRow | null> {
  const supabase = await createSSRClient();
  const { data, error } = await supabase
    .from('chunks')
    .select(CHUNK_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as ChunkRow;
}

export interface ResolvedChunks {
  chunks: ChunkRow[];
  documents: Map<string, CitationDocumentMeta>;
}

/**
 * Batch-fetch chunks + their parent documents (RLS-scoped) for the citation
 * resolver. Returns a map keyed by `document_id` so the caller can hydrate
 * the citation without re-querying per chunk. Chunks the caller can't see
 * are silently dropped by RLS; the route handler turns them into
 * `unavailable` citation stubs.
 */
export async function fetchChunksForCitations(chunkIds: string[]): Promise<ResolvedChunks> {
  if (chunkIds.length === 0) return { chunks: [], documents: new Map() };

  const supabase = await createSSRClient();
  const { data: chunkData, error: chunkErr } = await supabase
    .from('chunks')
    .select(CHUNK_COLUMNS)
    .in('id', chunkIds);
  if (chunkErr || !chunkData) return { chunks: [], documents: new Map() };

  const chunks = chunkData as unknown as ChunkRow[];
  const documentIds = Array.from(new Set(chunks.map((c) => c.document_id)));
  if (documentIds.length === 0) return { chunks, documents: new Map() };

  const { data: docData, error: docErr } = await supabase
    .from('documents')
    .select('id, title, version')
    .in('id', documentIds);
  if (docErr || !docData) return { chunks, documents: new Map() };

  const documents = new Map<string, CitationDocumentMeta>();
  for (const row of docData as unknown as CitationDocumentMeta[]) {
    documents.set(row.id, row);
  }
  return { chunks, documents };
}
