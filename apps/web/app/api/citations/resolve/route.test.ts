// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { createSchemaValidator } from '@document-chat/contracts/test-utils';
import type { ChunkRow, CitationDocumentMeta } from '../../../../lib/chunks';

vi.mock('../../../../lib/auth', () => ({ getOptionalUser: vi.fn() }));
vi.mock('../../../../lib/chunks-store', () => ({ fetchChunksForCitations: vi.fn() }));

import { getOptionalUser } from '../../../../lib/auth';
import { fetchChunksForCitations } from '../../../../lib/chunks-store';
import { POST } from './route';

const validator = await createSchemaValidator();
const user = { id: '00000000-0000-0000-0000-000000000001', email: 'ada@example.com' } as unknown as User;
const CHUNK_A = '33333333-3333-3333-3333-3333333333aa';
const CHUNK_B = '33333333-3333-3333-3333-3333333333bb';
const DOC_ID = '22222222-2222-2222-2222-222222222222';

const chunkA: ChunkRow = {
  id: CHUNK_A,
  document_id: DOC_ID,
  index: 0,
  text: 'Hello',
  token_count: 1,
  embedding_model: 'text-embedding-3-small',
  page_number: 1,
  char_start: 0,
  char_end: 5,
  section_path: null,
  created_at: '2026-06-08T00:00:00.000Z',
  updated_at: '2026-06-08T00:00:00.000Z',
};

const docMeta: CitationDocumentMeta = {
  id: DOC_ID,
  title: 'Quarterly report',
  version: '1.0',
};

function req(body: unknown): Request {
  return new Request('http://localhost/api/citations:resolve', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.mocked(getOptionalUser).mockResolvedValue(user);
  vi.mocked(fetchChunksForCitations).mockReset();
  vi.mocked(fetchChunksForCitations).mockResolvedValue({
    chunks: [chunkA],
    documents: new Map([[DOC_ID, docMeta]]),
  });
});

describe('POST /citations:resolve', () => {
  it('401 when not signed in', async () => {
    vi.mocked(getOptionalUser).mockResolvedValue(null);
    const res = await POST(req({ chunk_ids: [CHUNK_A] }));
    expect(res.status).toBe(401);
  });

  it('400 when chunk_ids is empty', async () => {
    const res = await POST(req({ chunk_ids: [] }));
    expect(res.status).toBe(400);
  });

  it('400 when a chunk_id is not a UUID', async () => {
    const res = await POST(req({ chunk_ids: ['not-a-uuid'] }));
    expect(res.status).toBe(400);
  });

  it('200 with a hydrated Citation for a resolvable chunk', async () => {
    const res = await POST(req({ chunk_ids: [CHUNK_A] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(validator.validate('ResolveCitationsResponse', body).valid, JSON.stringify(body)).toBe(true);
    expect(body.citations).toHaveLength(1);
    expect(body.citations[0].chunk_id).toBe(CHUNK_A);
    expect(body.citations[0].document_title).toBe('Quarterly report');
    expect(body.citations[0].unavailable).toBe(false);
  });

  it('returns an unavailable stub for a chunk the user cannot resolve', async () => {
    const res = await POST(req({ chunk_ids: [CHUNK_A, CHUNK_B] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.citations).toHaveLength(2);
    const missing = body.citations.find((c: { chunk_id: string }) => c.chunk_id === CHUNK_B);
    expect(missing.unavailable).toBe(true);
    expect(missing.unavailable_reason).toMatch(/no longer available/);
  });

  it('preserves request order and emits one citation per requested entry, including duplicates', async () => {
    const res = await POST(req({ chunk_ids: [CHUNK_A, CHUNK_A] }));
    const body = await res.json();
    expect(body.citations).toHaveLength(2);
    expect(body.citations[0].chunk_id).toBe(CHUNK_A);
    expect(body.citations[1].chunk_id).toBe(CHUNK_A);
  });
});
