// SPDX-License-Identifier: Apache-2.0
// Storage + database I/O for documents. Mocked wholesale in route unit tests;
// exercised against a real stack by integration tests / on deploy.
import { createAdminClient } from './supabase/admin';
import { createSSRClient } from './supabase/server';
import { DOCUMENTS_BUCKET, DEFAULT_EMBEDDING_MODEL, type DocumentRow } from './documents';

const DOCUMENT_COLUMNS =
  'id, workspace_id, title, version, status, effective_date, ingestion_state, ' +
  'ingestion_error, size_bytes, page_count, content_type, storage_object_key, ' +
  'embedding_model, uploaded_by, created_at, updated_at';

/** Mint a signed upload URL the browser can PUT the file to. */
export async function mintUploadUrl(objectKey: string): Promise<{ signedUrl: string } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(objectKey);
  if (error || !data) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const signedUrl = data.signedUrl.startsWith('http')
    ? data.signedUrl
    : `${base}/storage/v1${data.signedUrl}`;
  return { signedUrl };
}

/** Look up an uploaded object's size/type to validate finalize. Null if absent. */
export async function findUploadedObject(
  workspaceId: string,
  objectName: string,
): Promise<{ size: number; mimetype: string } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .list(workspaceId, { search: objectName, limit: 100 });
  if (error || !data) return null;
  const obj = data.find((o) => o.name === objectName);
  if (!obj?.metadata) return null;
  return {
    size: Number(obj.metadata.size ?? 0),
    mimetype: String(obj.metadata.mimetype ?? ''),
  };
}

export interface NewDocument {
  workspaceId: string;
  title: string;
  version: string;
  status: 'draft' | 'current';
  effectiveDate: string | null;
  sizeBytes: number;
  contentType: string;
  storageObjectKey: string;
  uploadedBy: string;
}

/** Insert a document row with the user's RLS-scoped client. Null on failure. */
export async function insertDocument(doc: NewDocument): Promise<DocumentRow | null> {
  const supabase = await createSSRClient();
  const { data, error } = await supabase
    .from('documents')
    .insert({
      workspace_id: doc.workspaceId,
      title: doc.title,
      version: doc.version,
      status: doc.status,
      effective_date: doc.effectiveDate,
      ingestion_state: 'pending',
      size_bytes: doc.sizeBytes,
      content_type: doc.contentType,
      storage_object_key: doc.storageObjectKey,
      embedding_model: DEFAULT_EMBEDDING_MODEL,
      uploaded_by: doc.uploadedBy,
    })
    .select(DOCUMENT_COLUMNS)
    .single();
  if (error || !data) return null;
  return data as unknown as DocumentRow;
}
