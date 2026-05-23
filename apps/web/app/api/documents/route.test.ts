// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import type { components } from '@document-chat/contracts';
import { createSchemaValidator } from '@document-chat/contracts/test-utils';
import type { DocumentRow } from '../../../lib/documents';

vi.mock('../../../lib/auth', () => ({ getOptionalUser: vi.fn() }));
vi.mock('../../../lib/workspace', () => ({ getCurrentWorkspace: vi.fn() }));
vi.mock('../../../lib/documents-store', () => ({
  findUploadedObject: vi.fn(),
  insertDocument: vi.fn(),
  listDocuments: vi.fn(),
}));

import { getOptionalUser } from '../../../lib/auth';
import { getCurrentWorkspace } from '../../../lib/workspace';
import { findUploadedObject, insertDocument, listDocuments } from '../../../lib/documents-store';
import { GET, POST } from './route';

const validator = await createSchemaValidator();
const UPLOAD_ID = '11111111-1111-1111-1111-111111111111';
const user = { id: '00000000-0000-0000-0000-000000000001', email: 'ada@example.com' } as unknown as User;
const workspace: components['schemas']['Workspace'] = {
  id: '00000000-0000-0000-0000-0000000000aa',
  name: "ada's workspace",
  slug: 'ada',
  created_at: '2026-05-20T00:00:00.000Z',
  updated_at: '2026-05-20T00:00:00.000Z',
};

const row: DocumentRow = {
  id: '22222222-2222-2222-2222-222222222222',
  workspace_id: workspace.id,
  title: 'Quarterly report',
  version: '1.0',
  status: 'current',
  effective_date: null,
  ingestion_state: 'pending',
  ingestion_error: null,
  size_bytes: 1024,
  page_count: null,
  content_type: 'application/pdf',
  storage_object_key: `${workspace.id}/${UPLOAD_ID}.pdf`,
  embedding_model: 'text-embedding-3-small',
  uploaded_by: user.id,
  created_at: '2026-05-23T00:00:00.000Z',
  updated_at: '2026-05-23T00:00:00.000Z',
};

function req(body: unknown): Request {
  return new Request('http://localhost/api/documents', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.mocked(getOptionalUser).mockResolvedValue(user);
  vi.mocked(getCurrentWorkspace).mockResolvedValue(workspace);
  vi.mocked(findUploadedObject).mockReset();
  vi.mocked(insertDocument).mockReset();
  vi.mocked(listDocuments).mockReset();
  vi.mocked(findUploadedObject).mockResolvedValue({ size: 1024, mimetype: 'application/pdf' });
  vi.mocked(insertDocument).mockResolvedValue(row);
  vi.mocked(listDocuments).mockResolvedValue({ items: [row], nextCursor: null });
});

describe('GET /documents (list)', () => {
  it('401 when not signed in', async () => {
    vi.mocked(getOptionalUser).mockResolvedValue(null);
    const res = await GET(new Request('http://localhost/api/documents'));
    expect(res.status).toBe(401);
  });

  it('400 on an invalid sort field', async () => {
    const res = await GET(new Request('http://localhost/api/documents?sort=bogus'));
    expect(res.status).toBe(400);
  });

  it('200 with a PaginatedDocuments-shaped body', async () => {
    vi.mocked(listDocuments).mockResolvedValue({ items: [row], nextCursor: 'b2Zmc2V0' });
    const res = await GET(new Request('http://localhost/api/documents?limit=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const result = validator.validate('PaginatedDocuments', body);
    expect(result.valid, JSON.stringify(result.errors)).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.page.limit).toBe(1);
    expect(body.page.next_cursor).toBe('b2Zmc2V0');
  });
});

describe('POST /documents (finalize)', () => {
  it('401 when not signed in', async () => {
    vi.mocked(getOptionalUser).mockResolvedValue(null);
    const res = await POST(req({ upload_id: UPLOAD_ID, title: 'x' }));
    expect(res.status).toBe(401);
  });

  it('422 when the uploaded object is missing', async () => {
    vi.mocked(findUploadedObject).mockResolvedValue(null);
    const res = await POST(req({ upload_id: UPLOAD_ID, title: 'x' }));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('document.upload_incomplete');
  });

  it('201 with a Document-shaped body on success', async () => {
    const res = await POST(req({ upload_id: UPLOAD_ID, title: 'Quarterly report' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    const result = validator.validate('Document', body);
    expect(result.valid, JSON.stringify(result.errors)).toBe(true);
    expect(body.ingestion_state).toBe('pending');
    expect(body.uploaded_by.user_id).toBe(user.id);
  });
});
