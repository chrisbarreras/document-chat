// SPDX-License-Identifier: Apache-2.0
// Pure constants + contract mapping for chunks + citations. No I/O —
// storage / DB access lives in chunks-store.ts. Mirrors the documents.ts
// split so route unit tests can import this file without mocking.
import type { components } from '@document-chat/contracts';

type Chunk = components['schemas']['Chunk'];
type Citation = components['schemas']['Citation'];

/** A `chunks` row as selected from Postgres (snake_case columns). */
export interface ChunkRow {
  id: string;
  document_id: string;
  index: number;
  text: string;
  token_count: number;
  embedding_model: string;
  page_number: number | null;
  char_start: number;
  char_end: number;
  section_path: string[] | null;
  created_at: string;
  updated_at: string;
}

/** Map a DB row to the OpenAPI `Chunk`. */
export function toContractChunk(row: ChunkRow): Chunk {
  return {
    id: row.id,
    document_id: row.document_id,
    index: row.index,
    text: row.text,
    token_count: row.token_count,
    embedding_model: row.embedding_model,
    page_number: row.page_number,
    char_start: row.char_start,
    char_end: row.char_end,
    ...(row.section_path !== null ? { section_path: row.section_path } : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Build the excerpt shown in a citation. Tier 1: the full chunk text. Tier 4
 * may shorten this to a quote spanning only the cited sentence.
 */
function buildExcerpt(text: string): string {
  return text;
}

/**
 * Document fields a citation needs. Smaller than the full DocumentRow so the
 * resolver can fetch just `id, title, version` for the citation set.
 */
export interface CitationDocumentMeta {
  id: string;
  title: string;
  version: string;
}

/**
 * Map a chunk row + its document meta to a hydrated Citation. `score` is
 * carried through only when the caller produced it from retrieval; the
 * batch resolver (POST /citations:resolve) omits it.
 */
export function toContractCitation(
  chunk: ChunkRow,
  doc: CitationDocumentMeta,
  options: { score?: number } = {},
): Citation {
  return {
    id: crypto.randomUUID(),
    chunk_id: chunk.id,
    document_id: doc.id,
    document_title: doc.title,
    document_version: doc.version,
    page_number: chunk.page_number,
    excerpt: buildExcerpt(chunk.text),
    ...(options.score !== undefined ? { score: options.score } : {}),
    unavailable: false,
    unavailable_reason: null,
  };
}

/**
 * Citation stub for a chunk_id the caller asked us to resolve but for which
 * the underlying chunk has been deleted (REQ-1.2.4 graceful degrade).
 */
export function unavailableCitation(chunkId: string, reason: string): Citation {
  return {
    id: crypto.randomUUID(),
    chunk_id: chunkId,
    document_id: '00000000-0000-0000-0000-000000000000',
    document_title: '',
    document_version: '',
    page_number: null,
    excerpt: '',
    unavailable: true,
    unavailable_reason: reason,
  };
}
