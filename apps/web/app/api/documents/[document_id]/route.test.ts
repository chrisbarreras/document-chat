// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { createSchemaValidator } from '@document-chat/contracts/test-utils';
import type { DocumentRow } from '../../../../lib/documents';

vi.mock('../../../../lib/auth', () => ({ getOptionalUser: vi.fn() }));
vi.mock('../../../../lib/documents-store', () => ({
  getDocumentRow: vi.fn(),
  updateDocumentRow: vi.fn(),
  deleteDocumentAndObject: vi.fn(),
}));

import { getOptionalUser } from '../../../../lib/auth';
import {
  getDocumentRow,
  updateDocumentRow,
  deleteDocumentAndObject,
} from '../../../../lib/documents-store';
import { GET, PATCH, DELETE } from './route';

const validator = await createSchemaValidator();
const DOC_ID = '22222222-2222-2222-2222-222222222222';
const user = { id: '00000000-0000-0000-0000-000000000001', email: 'ada@example.com' } as unknown as User;

const row: DocumentRow = {
  id: DOC_ID,
  workspace_id: '00000000-0000-0000-0000-0000000000aa',
  title: 'Quarterly report',
  version: '1.0',
  status: 'current',
  effective_date: null,
  ingestion_state: 'ready',
  ingestion_error: null,
  size_bytes: 1024,
  page_count: 12,
  content_type: 'application/pdf',
  storage_object_key: 'ws/doc.pdf',
  embedding_model: 'text-embedding-3-small',
  uploaded_by: user.id,
  created_at: '2026-05-23T00:00:00.000Z',
  updated_at: '2026-05-23T00:00:00.000Z',
};

const ctx = { params: Promise.resolve({ document_id: DOC_ID }) };
function patchReq(body: unknown): Request {
  return new Request(`http://localhost/api/documents/${DOC_ID}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.mocked(getOptionalUser).mockResolvedValue(user);
  vi.mocked(getDocumentRow).mockReset();
  vi.mocked(updateDocumentRow).mockReset();
  vi.mocked(deleteDocumentAndObject).mockReset();
});

describe('GET /documents/{id}', () => {
  it('404 when absent or not owned', async () => {
    vi.mocked(getDocumentRow).mockResolvedValue(null);
    const res = await GET(new Request('http://localhost'), ctx);
    expect(res.status).toBe(404);
  });

  it('200 with a Document body', async () => {
    vi.mocked(getDocumentRow).mockResolvedValue(row);
    const res = await GET(new Request('http://localhost'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(validator.validate('Document', body).valid, JSON.stringify(body)).toBe(true);
    expect(body.id).toBe(DOC_ID);
  });
});

describe('PATCH /documents/{id}', () => {
  it('400 when no fields are provided', async () => {
    const res = await PATCH(patchReq({}), ctx);
    expect(res.status).toBe(400);
  });

  it('422 on an out-of-range status', async () => {
    const res = await PATCH(patchReq({ status: 'superseded' }), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('document.invalid_status');
  });

  it('404 when the document is absent', async () => {
    vi.mocked(updateDocumentRow).mockResolvedValue(null);
    const res = await PATCH(patchReq({ title: 'New title' }), ctx);
    expect(res.status).toBe(404);
  });

  it('200 with the updated Document', async () => {
    vi.mocked(updateDocumentRow).mockResolvedValue({ ...row, title: 'New title' });
    const res = await PATCH(patchReq({ title: 'New title' }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(validator.validate('Document', body).valid, JSON.stringify(body)).toBe(true);
    expect(body.title).toBe('New title');
  });
});

describe('DELETE /documents/{id}', () => {
  it('404 when nothing was deleted', async () => {
    vi.mocked(deleteDocumentAndObject).mockResolvedValue(false);
    const res = await DELETE(new Request('http://localhost'), ctx);
    expect(res.status).toBe(404);
  });

  it('204 on success', async () => {
    vi.mocked(deleteDocumentAndObject).mockResolvedValue(true);
    const res = await DELETE(new Request('http://localhost'), ctx);
    expect(res.status).toBe(204);
  });
});
