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

/**
 * Patch an existing `documents` row via the service-role client. Inngest
 * pipeline steps update ingestion state outside any user session; RLS still
 * prevents user-facing API paths from making the same edit.
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
