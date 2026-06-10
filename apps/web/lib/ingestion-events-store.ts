// SPDX-License-Identifier: Apache-2.0
// Database I/O for ingestion_events. JSON-paginated history reads + SSE
// polling reads both run through the cookie-bound (RLS-scoped) client; the
// writes happen inside the Inngest pipeline via the admin client.
import { createSSRClient } from './supabase/server';
import { encodeCursor, decodeCursor } from './documents';
import type { components } from '@document-chat/contracts';

type IngestionEvent = components['schemas']['IngestionEvent'];

const EVENT_COLUMNS =
  'id, document_id, event, from_state, to_state, ' +
  'progress_processed, progress_total, error, occurred_at';

/** A `ingestion_events` row as selected from Postgres. */
export interface IngestionEventRow {
  id: string;
  document_id: string;
  event: 'state_changed' | 'chunk_extracted' | 'embedding_progress' | 'warning' | 'failed';
  from_state:
    | 'pending'
    | 'extracting'
    | 'chunking'
    | 'embedding'
    | 'ready'
    | 'failed'
    | null;
  to_state:
    | 'pending'
    | 'extracting'
    | 'chunking'
    | 'embedding'
    | 'ready'
    | 'failed'
    | null;
  progress_processed: number | null;
  progress_total: number | null;
  error: unknown;
  occurred_at: string;
}

/** Map a DB row to the OpenAPI `IngestionEvent`. */
export function toContractIngestionEvent(row: IngestionEventRow): IngestionEvent {
  const out: IngestionEvent = {
    id: row.id,
    document_id: row.document_id,
    event: row.event,
    occurred_at: row.occurred_at,
  };
  if (row.from_state !== null) out.from_state = row.from_state;
  if (row.to_state !== null) out.to_state = row.to_state;
  if (row.progress_processed !== null || row.progress_total !== null) {
    out.progress = {
      ...(row.progress_processed !== null ? { processed: row.progress_processed } : {}),
      ...(row.progress_total !== null ? { total: row.progress_total } : {}),
    };
  }
  if (row.error) out.error = row.error as NonNullable<IngestionEvent['error']>;
  return out;
}

export interface ListIngestionEventsParams {
  documentId: string;
  cursor?: string;
  limit: number;
}

/**
 * List events for a document oldest-first so the UI can render a chronological
 * log without re-sorting. Cursor pagination mirrors documents/chunks.
 */
export async function listIngestionEvents(
  params: ListIngestionEventsParams,
): Promise<{ items: IngestionEventRow[]; nextCursor: string | null }> {
  const supabase = await createSSRClient();
  const offset = decodeCursor(params.cursor);

  const { data, error } = await supabase
    .from('ingestion_events')
    .select(EVENT_COLUMNS)
    .eq('document_id', params.documentId)
    .order('occurred_at', { ascending: true })
    .order('id', { ascending: true })
    .range(offset, offset + params.limit);

  if (error || !data) return { items: [], nextCursor: null };

  const rows = data as unknown as IngestionEventRow[];
  const hasMore = rows.length > params.limit;
  const items = hasMore ? rows.slice(0, params.limit) : rows;
  const nextCursor = hasMore ? encodeCursor(offset + params.limit) : null;
  return { items, nextCursor };
}

/**
 * Fetch any events that occurred after `afterId` (exclusive). Returns rows
 * in occurrence order so the SSE handler can emit them sequentially. Used by
 * the SSE polling loop to drain new events between heartbeats.
 */
export async function getEventsSince(
  documentId: string,
  afterTimestamp: string | null,
  afterId: string | null,
): Promise<IngestionEventRow[]> {
  const supabase = await createSSRClient();
  let query = supabase
    .from('ingestion_events')
    .select(EVENT_COLUMNS)
    .eq('document_id', documentId)
    .order('occurred_at', { ascending: true })
    .order('id', { ascending: true });
  if (afterTimestamp && afterId) {
    // Tuple cursor over (occurred_at, id): strictly greater than (ts, id).
    // PostgREST has no native tuple comparison, so emulate with `or`.
    query = query.or(
      `occurred_at.gt.${afterTimestamp},and(occurred_at.eq.${afterTimestamp},id.gt.${afterId})`,
    );
  }
  const { data, error } = await query.limit(100);
  if (error || !data) return [];
  return data as unknown as IngestionEventRow[];
}
