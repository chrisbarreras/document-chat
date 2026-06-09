// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { createSchemaValidator } from '@document-chat/contracts/test-utils';
import type { ChunkRow } from '../../../../../lib/chunks';
import type { DocumentRow } from '../../../../../lib/documents';

vi.mock('../../../../../lib/auth', () => ({ getOptionalUser: vi.fn() }));
vi.mock('../../../../../lib/documents-store', () => ({ getDocumentRow: vi.fn() }));
vi.mock('../../../../../lib/chunks-store', () => ({ listDocumentChunks: vi.fn() }));

import { getOptionalUser } from '../../../../../lib/auth';
import { getDocumentRow } from '../../../../../lib/documents-store';
import { listDocumentChunks } from '../../../../../lib/chunks-store';
import { GET } from './route';

const validator = await createSchemaValidator();
const DOC_ID = '22222222-2222-2222-2222-222222222222';
const user = { id: '00000000-0000-0000-0000-000000000001', email: 'ada@example.com' } as unknown as User;

const docRow: DocumentRow = {
  id: DOC_ID,
  workspace_id: '00000000-0000-0000-0000-0000000000aa',
  title: 'Quarterly report',
  version: '1.0',
  status: 'current',
  effective_date: null,
  ingestion_state: 'ready',
  ingestion_error: null,
  size_bytes: 1024,
  page_count: 1,
  content_type: 'application/pdf',
  storage_object_key: 'ws/doc.pdf',
  embedding_model: 'text-embedding-3-small',
  uploaded_by: user.id,
  created_at: '2026-06-08T00:00:00.000Z',
  updated_at: '2026-06-08T00:00:00.000Z',
};

const chunkRow: ChunkRow = {
  id: '33333333-3333-3333-3333-333333333333',
  document_id: DOC_ID,
  index: 0,
  text: 'Hello world',
  token_count: 3,
  embedding_model: 'text-embedding-3-small',
  page_number: 1,
  char_start: 0,
  char_end: 11,
  section_path: null,
  created_at: '2026-06-08T00:00:00.000Z',
  updated_at: '2026-06-08T00:00:00.000Z',
};

const ctx = { params: Promise.resolve({ document_id: DOC_ID }) };

beforeEach(() => {
  vi.mocked(getOptionalUser).mockResolvedValue(user);
  vi.mocked(getDocumentRow).mockReset();
  vi.mocked(listDocumentChunks).mockReset();
  vi.mocked(getDocumentRow).mockResolvedValue(docRow);
  vi.mocked(listDocumentChunks).mockResolvedValue({ items: [chunkRow], nextCursor: null });
});

describe('GET /documents/{id}/chunks', () => {
  it('401 when not signed in', async () => {
    vi.mocked(getOptionalUser).mockResolvedValue(null);
    const res = await GET(new Request(`http://localhost/api/documents/${DOC_ID}/chunks`), ctx);
    expect(res.status).toBe(401);
  });

  it('404 when the document is absent or not owned', async () => {
    vi.mocked(getDocumentRow).mockResolvedValue(null);
    const res = await GET(new Request(`http://localhost/api/documents/${DOC_ID}/chunks`), ctx);
    expect(res.status).toBe(404);
  });

  it('400 on an out-of-range limit', async () => {
    const res = await GET(
      new Request(`http://localhost/api/documents/${DOC_ID}/chunks?limit=999`),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it('200 with a PaginatedChunks-shaped body', async () => {
    vi.mocked(listDocumentChunks).mockResolvedValue({ items: [chunkRow], nextCursor: 'next' });
    const res = await GET(
      new Request(`http://localhost/api/documents/${DOC_ID}/chunks?limit=5`),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(validator.validate('PaginatedChunks', body).valid, JSON.stringify(body)).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.page.limit).toBe(5);
    expect(body.page.next_cursor).toBe('next');
  });
});
