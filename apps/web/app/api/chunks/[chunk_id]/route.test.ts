// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { createSchemaValidator } from '@document-chat/contracts/test-utils';
import type { ChunkRow } from '../../../../lib/chunks';

vi.mock('../../../../lib/auth', () => ({ getOptionalUser: vi.fn() }));
vi.mock('../../../../lib/chunks-store', () => ({ getChunkRow: vi.fn() }));

import { getOptionalUser } from '../../../../lib/auth';
import { getChunkRow } from '../../../../lib/chunks-store';
import { GET } from './route';

const validator = await createSchemaValidator();
const CHUNK_ID = '33333333-3333-3333-3333-333333333333';
const user = { id: '00000000-0000-0000-0000-000000000001', email: 'ada@example.com' } as unknown as User;

const row: ChunkRow = {
  id: CHUNK_ID,
  document_id: '22222222-2222-2222-2222-222222222222',
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

const ctx = { params: Promise.resolve({ chunk_id: CHUNK_ID }) };

beforeEach(() => {
  vi.mocked(getOptionalUser).mockResolvedValue(user);
  vi.mocked(getChunkRow).mockReset();
});

describe('GET /chunks/{id}', () => {
  it('401 when not signed in', async () => {
    vi.mocked(getOptionalUser).mockResolvedValue(null);
    const res = await GET(new Request('http://localhost'), ctx);
    expect(res.status).toBe(401);
  });

  it('404 when the chunk is absent or RLS-hidden', async () => {
    vi.mocked(getChunkRow).mockResolvedValue(null);
    const res = await GET(new Request('http://localhost'), ctx);
    expect(res.status).toBe(404);
  });

  it('200 with a Chunk-shaped body', async () => {
    vi.mocked(getChunkRow).mockResolvedValue(row);
    const res = await GET(new Request('http://localhost'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(validator.validate('Chunk', body).valid, JSON.stringify(body)).toBe(true);
    expect(body.id).toBe(CHUNK_ID);
  });
});
