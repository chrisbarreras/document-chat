// SPDX-License-Identifier: Apache-2.0
// Pure constants + contract mapping for documents. No I/O here (so route unit
// tests can import it without mocking) — storage/DB access lives in
// documents-store.ts.
import type { components } from '@document-chat/contracts';

export const DOCUMENTS_BUCKET = 'documents';
export const MAX_UPLOAD_BYTES = 52_428_800; // 50 MB (REQ-1.1.1)
export const ALLOWED_CONTENT_TYPES = ['application/pdf'] as const;
// Supabase signed upload URLs are valid for ~2 hours; we report it, not set it.
export const SIGNED_UPLOAD_URL_TTL_SECONDS = 7200;
// Recorded on each document; chunks record the model actually used at embed time.
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

type Document = components['schemas']['Document'];

/** A `documents` row as selected from Postgres (snake_case columns). */
export interface DocumentRow {
  id: string;
  workspace_id: string;
  title: string;
  version: string;
  status: 'draft' | 'current' | 'retired';
  effective_date: string | null;
  ingestion_state: 'pending' | 'extracting' | 'chunking' | 'embedding' | 'ready' | 'failed';
  ingestion_error: string | null;
  size_bytes: number;
  page_count: number | null;
  content_type: string;
  storage_object_key: string;
  embedding_model: string;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * Map a DB row to the OpenAPI `Document`. `uploaded_by` is the row's uuid; the
 * contract wants an Actor, so the caller passes the resolved uploader (for a
 * freshly created document that's the current user).
 */
export function toContractDocument(
  row: DocumentRow,
  uploader: { user_id: string; email?: string },
): Document {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    title: row.title,
    version: row.version,
    status: row.status,
    effective_date: row.effective_date,
    ingestion_state: row.ingestion_state,
    ingestion_error: row.ingestion_error,
    size_bytes: row.size_bytes,
    page_count: row.page_count,
    content_type: row.content_type,
    storage_object_key: row.storage_object_key,
    embedding_model: row.embedding_model,
    uploaded_by: {
      user_id: uploader.user_id,
      ...(uploader.email ? { email: uploader.email } : {}),
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
