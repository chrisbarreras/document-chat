// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { createSchemaValidator } from '@document-chat/contracts/test-utils';
import type { DocumentRow } from '../../../../../lib/documents';

vi.mock('../../../../../lib/auth', () => ({ getOptionalUser: vi.fn() }));
vi.mock('../../../../../lib/documents-store', () => ({ getDocumentRow: vi.fn() }));
vi.mock('../../../../../lib/inngest/client', () => ({ sendDocumentUploaded: vi.fn() }));
vi.mock('../../../../../lib/inngest/storage', () => ({ recordIngestionTransition: vi.fn() }));

import { getOptionalUser } from '../../../../../lib/auth';
import { getDocumentRow } from '../../../../../lib/documents-store';
import { sendDocumentUploaded } from '../../../../../lib/inngest/client';
import { recordIngestionTransition } from '../../../../../lib/inngest/storage';
import { POST } from './route';

const validator = await createSchemaValidator();
const DOC_ID = '22222222-2222-2222-2222-222222222222';
const user = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'ada@example.com',
} as unknown as User;

const row: DocumentRow = {
  id: DOC_ID,
  workspace_id: '00000000-0000-0000-0000-0000000000aa',
  title: 'Quarterly report',
  version: '1.0',
  status: 'current',
  effective_date: null,
  ingestion_state: 'failed',
  ingestion_error: 'object missing',
  size_bytes: 1024,
  page_count: null,
  content_type: 'application/pdf',
  storage_object_key: 'ws/doc.pdf',
  embedding_model: 'text-embedding-3-small',
  uploaded_by: user.id,
  created_at: '2026-06-10T00:00:00.000Z',
  updated_at: '2026-06-10T00:00:00.000Z',
};

const ctx = { params: Promise.resolve({ document_id: DOC_ID }) };

beforeEach(() => {
  vi.mocked(getOptionalUser).mockResolvedValue(user);
  vi.mocked(getDocumentRow).mockReset();
  vi.mocked(getDocumentRow).mockResolvedValue(row);
  vi.mocked(sendDocumentUploaded).mockReset();
  vi.mocked(sendDocumentUploaded).mockResolvedValue(undefined);
  vi.mocked(recordIngestionTransition).mockReset();
  vi.mocked(recordIngestionTransition).mockResolvedValue(undefined);
});

describe('POST /documents/{id}:reprocess', () => {
  it('401 when not signed in', async () => {
    vi.mocked(getOptionalUser).mockResolvedValue(null);
    const res = await POST(new Request('http://localhost'), ctx);
    expect(res.status).toBe(401);
  });

  it('404 when the document is absent', async () => {
    vi.mocked(getDocumentRow).mockResolvedValue(null);
    const res = await POST(new Request('http://localhost'), ctx);
    expect(res.status).toBe(404);
  });

  it('202 with a Document-shaped body on success', async () => {
    const res = await POST(new Request('http://localhost'), ctx);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(validator.validate('Document', body).valid, JSON.stringify(body)).toBe(true);
    expect(body.id).toBe(DOC_ID);
  });

  it('resets ingestion_state via the transition helper', async () => {
    await POST(new Request('http://localhost'), ctx);
    expect(recordIngestionTransition).toHaveBeenCalledWith(DOC_ID, 'pending', {
      ingestionError: null,
    });
  });

  it('re-emits the document.uploaded event', async () => {
    await POST(new Request('http://localhost'), ctx);
    expect(sendDocumentUploaded).toHaveBeenCalledWith({
      document_id: row.id,
      workspace_id: row.workspace_id,
      storage_object_key: row.storage_object_key,
    });
  });

  it('still returns 202 when the inngest send fails', async () => {
    vi.mocked(sendDocumentUploaded).mockRejectedValueOnce(new Error('inngest down'));
    const res = await POST(new Request('http://localhost'), ctx);
    expect(res.status).toBe(202);
  });

  it('returns 500 when the transition helper fails', async () => {
    vi.mocked(recordIngestionTransition).mockRejectedValueOnce(new Error('db down'));
    const res = await POST(new Request('http://localhost'), ctx);
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('document.reprocess_failed');
  });
});
