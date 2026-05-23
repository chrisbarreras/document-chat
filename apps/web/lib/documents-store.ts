// SPDX-License-Identifier: Apache-2.0
// Storage + database I/O for documents. Mocked wholesale in route unit tests;
// exercised against a real stack by integration tests / on deploy.
import { createAdminClient } from './supabase/admin';
import { createSSRClient } from './supabase/server';
import {
  DOCUMENTS_BUCKET,
  DEFAULT_EMBEDDING_MODEL,
  DOCUMENT_SORT_COLUMNS,
  encodeCursor,
  decodeCursor,
  type DocumentRow,
  type DocumentSort,
} from './documents';

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

export interface ListDocumentsParams {
  status?: string;
  q?: string;
  sort: DocumentSort;
  ascending: boolean;
  cursor?: string;
  limit: number;
}

/** List the caller's documents (RLS-scoped), with filter/sort/offset cursor. */
export async function listDocuments(
  params: ListDocumentsParams,
): Promise<{ items: DocumentRow[]; nextCursor: string | null }> {
  const supabase = await createSSRClient();
  const column = DOCUMENT_SORT_COLUMNS[params.sort];
  const offset = decodeCursor(params.cursor);

  let query = supabase.from('documents').select(DOCUMENT_COLUMNS);
  if (params.status) query = query.eq('status', params.status);
  if (params.q) query = query.ilike('title', `%${params.q}%`);

  // Fetch one extra row to detect whether another page exists. Secondary sort
  // on id keeps ordering stable across ties.
  const { data, error } = await query
    .order(column, { ascending: params.ascending })
    .order('id', { ascending: params.ascending })
    .range(offset, offset + params.limit);

  if (error || !data) return { items: [], nextCursor: null };

  const rows = data as unknown as DocumentRow[];
  const hasMore = rows.length > params.limit;
  const items = hasMore ? rows.slice(0, params.limit) : rows;
  const nextCursor = hasMore ? encodeCursor(offset + params.limit) : null;
  return { items, nextCursor };
}

/** Fetch a single document by id (RLS-scoped). Null if absent or not owned. */
export async function getDocumentRow(id: string): Promise<DocumentRow | null> {
  const supabase = await createSSRClient();
  const { data, error } = await supabase
    .from('documents')
    .select(DOCUMENT_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as DocumentRow;
}

/** Apply a partial (snake_case) update (RLS-scoped). Null if absent/not owned. */
export async function updateDocumentRow(
  id: string,
  patch: Record<string, unknown>,
): Promise<DocumentRow | null> {
  const supabase = await createSSRClient();
  const { data, error } = await supabase
    .from('documents')
    .update(patch)
    .eq('id', id)
    .select(DOCUMENT_COLUMNS)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as DocumentRow;
}

/**
 * Hard-delete a document (RLS-scoped) and its storage object. Chunks cascade
 * via FK. Returns false if no row was deleted (absent or not owned).
 */
export async function deleteDocumentAndObject(id: string): Promise<boolean> {
  const supabase = await createSSRClient();
  const { data, error } = await supabase
    .from('documents')
    .delete()
    .eq('id', id)
    .select('storage_object_key');
  if (error || !data || data.length === 0) return false;

  const key = (data[0] as { storage_object_key: string }).storage_object_key;
  // Best-effort: the row (and its chunks) are already gone; a missing object
  // shouldn't fail the delete.
  await createAdminClient().storage.from(DOCUMENTS_BUCKET).remove([key]);
  return true;
}
