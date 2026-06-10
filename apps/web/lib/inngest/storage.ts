// SPDX-License-Identifier: Apache-2.0
import { createAdminClient } from '../supabase/admin';
import { DOCUMENTS_BUCKET } from '../documents';

/**
 * Row shape inserted into the `chunks` table. Mirrors the SQL columns and
 * the Drizzle schema; kept here (not in documents.ts) because only the
 * ingestion pipeline writes chunks at Tier 1.
 */
export interface NewChunkRow {
  document_id: string;
  index: number;
  text: string;
  token_count: number;
  embedding_model: string;
  page_number: number | null;
  char_start: number;
  char_end: number;
  /** pgvector accepts a `[v1,v2,...]` string via PostgREST. */
  embedding: string;
}

/**
 * Download a stored document object as a Uint8Array using the service-role
 * client. Inngest functions run server-side outside any user session, so
 * RLS-scoped clients aren't usable here; the bucket's RLS still scopes user
 * uploads, but server-side reads are intentionally admin-scoped.
 */
export async function downloadDocumentObject(objectKey: string): Promise<Uint8Array> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(DOCUMENTS_BUCKET).download(objectKey);
  if (error || !data) {
    throw new Error(`storage download failed for ${objectKey}: ${error?.message ?? 'no data'}`);
  }
  const buffer = await data.arrayBuffer();
  return new Uint8Array(buffer);
}

/** Ingestion state machine values shared with the SQL enum. */
export type IngestionState =
  | 'pending'
  | 'extracting'
  | 'chunking'
  | 'embedding'
  | 'ready'
  | 'failed';

/**
 * Patch an existing `documents` row via the service-role client. Inngest
 * pipeline steps update ingestion state outside any user session; RLS still
 * prevents user-facing API paths from making the same edit.
 *
 * Prefer `recordIngestionTransition` when the patch is a state change — it
 * also writes the matching `ingestion_events` row so the UI can stream
 * progress.
 */
export async function patchDocumentRow(
  documentId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from('documents').update(patch).eq('id', documentId);
  if (error) {
    throw new Error(`document update failed for ${documentId}: ${error.message}`);
  }
}

interface TransitionOptions {
  /** Optional pageCount to persist alongside the state change. */
  pageCount?: number | null;
  /** Optional ingestion_error to persist (or clear with `null`). */
  ingestionError?: string | null;
  /**
   * Event kind to record. Defaults to `state_changed` for normal transitions
   * and `failed` for `toState === 'failed'`. Pass explicitly for
   * `chunk_extracted` / `embedding_progress` / `warning`.
   */
  eventKind?: 'state_changed' | 'chunk_extracted' | 'embedding_progress' | 'warning' | 'failed';
  /** Optional progress counters surfaced through the SSE event. */
  progress?: { processed: number; total: number };
  /** Optional Problem JSON when the transition is a failure. */
  errorPayload?: unknown;
}

/**
 * Drive a single state transition: update the documents row + append an
 * ingestion_events row. The event row records `from_state` from the row's
 * current value (read in the same call), so the UI can render an exact
 * history without the caller having to thread it through.
 *
 * Idempotent enough for retry: if the document is already in `toState`, the
 * patch is a no-op but the event row is still appended so the consumer sees
 * a heartbeat.
 */
export async function recordIngestionTransition(
  documentId: string,
  toState: IngestionState,
  options: TransitionOptions = {},
): Promise<void> {
  const admin = createAdminClient();

  const { data: current } = await admin
    .from('documents')
    .select('ingestion_state')
    .eq('id', documentId)
    .maybeSingle();
  const fromState = (current as { ingestion_state: IngestionState } | null)?.ingestion_state ?? null;

  const patch: Record<string, unknown> = { ingestion_state: toState };
  if (options.pageCount !== undefined) patch.page_count = options.pageCount;
  if (options.ingestionError !== undefined) patch.ingestion_error = options.ingestionError;

  const { error: updateError } = await admin
    .from('documents')
    .update(patch)
    .eq('id', documentId);
  if (updateError) {
    throw new Error(`document state update failed for ${documentId}: ${updateError.message}`);
  }

  const eventKind = options.eventKind ?? (toState === 'failed' ? 'failed' : 'state_changed');

  const eventRow: Record<string, unknown> = {
    document_id: documentId,
    event: eventKind,
    to_state: toState,
  };
  if (fromState !== null) eventRow.from_state = fromState;
  if (options.progress) {
    eventRow.progress_processed = options.progress.processed;
    eventRow.progress_total = options.progress.total;
  }
  if (options.errorPayload !== undefined) eventRow.error = options.errorPayload;

  const { error: insertError } = await admin.from('ingestion_events').insert(eventRow);
  if (insertError) {
    // A missed event is observability, not correctness. Log and move on so
    // the pipeline still makes progress.
    console.error('ingestion_events insert failed', insertError);
  }
}

/**
 * Insert chunk rows in a single batch via the service-role client. The
 * embedding step is idempotent: any prior chunks for the same document are
 * deleted first so a retry can't double-insert. Cascade FK ensures that a
 * later document-delete cleans up everything.
 */
export async function replaceDocumentChunks(
  documentId: string,
  rows: NewChunkRow[],
): Promise<void> {
  const admin = createAdminClient();
  const { error: deleteError } = await admin
    .from('chunks')
    .delete()
    .eq('document_id', documentId);
  if (deleteError) {
    throw new Error(`chunk delete failed for ${documentId}: ${deleteError.message}`);
  }
  if (rows.length === 0) return;
  const { error: insertError } = await admin.from('chunks').insert(rows);
  if (insertError) {
    throw new Error(`chunk insert failed for ${documentId}: ${insertError.message}`);
  }
}
