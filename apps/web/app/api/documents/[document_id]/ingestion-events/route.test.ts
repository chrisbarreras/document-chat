// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { createSchemaValidator } from '@document-chat/contracts/test-utils';
import type { DocumentRow } from '../../../../../lib/documents';
import type { IngestionEventRow } from '../../../../../lib/ingestion-events-store';

import type * as IngestionStoreModule from '../../../../../lib/ingestion-events-store';

vi.mock('../../../../../lib/auth', () => ({ getOptionalUser: vi.fn() }));
vi.mock('../../../../../lib/documents-store', () => ({ getDocumentRow: vi.fn() }));
vi.mock('../../../../../lib/ingestion-events-store', async () => {
  const actual =
    await vi.importActual<typeof IngestionStoreModule>(
      '../../../../../lib/ingestion-events-store',
    );
  return {
    ...actual,
    listIngestionEvents: vi.fn(),
    getEventsSince: vi.fn(),
  };
});

import { getOptionalUser } from '../../../../../lib/auth';
import { getDocumentRow } from '../../../../../lib/documents-store';
import {
  getEventsSince,
  listIngestionEvents,
} from '../../../../../lib/ingestion-events-store';
import { GET } from './route';

const validator = await createSchemaValidator();
const DOC_ID = '22222222-2222-2222-2222-222222222222';
const user = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'ada@example.com',
} as unknown as User;

const doc: DocumentRow = {
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
  created_at: '2026-06-10T00:00:00.000Z',
  updated_at: '2026-06-10T00:00:00.000Z',
};

const eventRow: IngestionEventRow = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  document_id: DOC_ID,
  event: 'state_changed',
  from_state: 'pending',
  to_state: 'extracting',
  progress_processed: null,
  progress_total: null,
  error: null,
  occurred_at: '2026-06-10T00:00:01.000Z',
};

const ctx = { params: Promise.resolve({ document_id: DOC_ID }) };

beforeEach(() => {
  vi.mocked(getOptionalUser).mockResolvedValue(user);
  vi.mocked(getDocumentRow).mockReset();
  vi.mocked(getDocumentRow).mockResolvedValue(doc);
  vi.mocked(listIngestionEvents).mockReset();
  vi.mocked(listIngestionEvents).mockResolvedValue({ items: [eventRow], nextCursor: null });
  vi.mocked(getEventsSince).mockReset();
  // For the SSE test the stream needs the document to start in a terminal
  // state so the polling loop closes immediately.
  vi.mocked(getEventsSince).mockResolvedValue([]);
});

describe('GET /documents/{id}/ingestion-events', () => {
  it('401 when not signed in', async () => {
    vi.mocked(getOptionalUser).mockResolvedValue(null);
    const res = await GET(new Request('http://localhost'), ctx);
    expect(res.status).toBe(401);
  });

  it('404 when the document is absent', async () => {
    vi.mocked(getDocumentRow).mockResolvedValue(null);
    const res = await GET(new Request('http://localhost'), ctx);
    expect(res.status).toBe(404);
  });

  it('JSON path returns a PaginatedIngestionEvents body', async () => {
    const res = await GET(new Request('http://localhost'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(
      validator.validate('PaginatedIngestionEvents', body).valid,
      JSON.stringify(body),
    ).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].event).toBe('state_changed');
  });

  it('400 on an out-of-range limit', async () => {
    const res = await GET(new Request('http://localhost?limit=999'), ctx);
    expect(res.status).toBe(400);
  });

  it('SSE path returns text/event-stream when Accept matches', async () => {
    const req = new Request('http://localhost', {
      headers: { accept: 'text/event-stream' },
    });
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    // Document is in a terminal state, so the stream closes after the
    // initial drain. Reading the body proves the controller closed cleanly.
    const text = await new Response(res.body).text();
    expect(typeof text).toBe('string');
  });
});
