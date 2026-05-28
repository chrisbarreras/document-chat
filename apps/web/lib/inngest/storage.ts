// SPDX-License-Identifier: Apache-2.0
import { createAdminClient } from '../supabase/admin';
import { DOCUMENTS_BUCKET } from '../documents';

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
