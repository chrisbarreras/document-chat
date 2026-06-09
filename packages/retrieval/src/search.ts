// SPDX-License-Identifier: Apache-2.0
//
// Vector-search helper backed by the `search_chunks` Postgres RPC. Pure with
// respect to the embeddings provider and the RPC caller, so unit tests can
// snapshot the call shape and integration tests can run against a real
// Supabase stack without coupling the package to `@supabase/supabase-js`.

import { embedQuery, type EmbedOptions } from './providers/openai';

/** Minimal subset of the Supabase client needed to invoke our RPC. */
export interface RpcClient {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
}

export const DEFAULT_TOP_K = 8;
export const MAX_TOP_K = 50;

export interface SearchOptions {
  /** Top-K to retrieve. Clamped to `[1, MAX_TOP_K]`. Default `DEFAULT_TOP_K`. */
  topK?: number;
  /** Options forwarded to `embedQuery` (fetch, apiKey, model). */
  embed?: EmbedOptions;
}

/**
 * A single result row returned by the `search_chunks` RPC. Mirrors the
 * function's RETURNS TABLE columns exactly. Mapping to the OpenAPI
 * `Chunk` / `Citation` schemas happens at the route-handler boundary in
 * `apps/web` — this row stays close to the SQL.
 */
export interface SearchResultRow {
  id: string;
  document_id: string;
  document_title: string;
  document_version: string;
  index: number;
  text: string;
  token_count: number;
  embedding_model: string;
  page_number: number | null;
  char_start: number;
  char_end: number;
  section_path: string[] | null;
  score: number;
  created_at: string;
  updated_at: string;
}

/**
 * Format a number array as the pgvector literal PostgREST accepts.
 * Equivalent to `apps/web/lib/inngest/functions/embed.ts`'s `toPgVector` —
 * duplicated here on purpose so the retrieval package stays decoupled.
 */
function toPgVector(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

/**
 * Run a kNN search over `chunks` scoped to `workspaceId`. Embeds the query
 * string, invokes the `search_chunks` RPC, and returns the rows in
 * cosine-similarity order. Retired-document filtering happens in the SQL
 * function (REQ-1.3.4); RLS is enforced by the caller's session.
 */
export async function searchChunks(
  rpcClient: RpcClient,
  workspaceId: string,
  query: string,
  options: SearchOptions = {},
): Promise<SearchResultRow[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    throw new Error('searchChunks: query must be non-empty');
  }

  const topK = Math.max(1, Math.min(MAX_TOP_K, options.topK ?? DEFAULT_TOP_K));
  const vector = await embedQuery(trimmed, options.embed);

  const { data, error } = await rpcClient.rpc('search_chunks', {
    p_workspace_id: workspaceId,
    p_query_embedding: toPgVector(vector),
    p_top_k: topK,
  });

  if (error) {
    throw new Error(`search_chunks rpc failed: ${error.message}`);
  }
  return (data as SearchResultRow[] | null) ?? [];
}
