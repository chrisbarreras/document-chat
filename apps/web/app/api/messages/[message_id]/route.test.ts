// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { createSchemaValidator } from '@document-chat/contracts/test-utils';
import type { MessageCitationRow, MessageRow } from '../../../../lib/chats';

vi.mock('../../../../lib/auth', () => ({ getOptionalUser: vi.fn() }));
vi.mock('../../../../lib/chats-store', () => ({
  getMessageRow: vi.fn(),
  getMessageCitations: vi.fn(),
}));

import { getOptionalUser } from '../../../../lib/auth';
import { getMessageCitations, getMessageRow } from '../../../../lib/chats-store';
import { GET } from './route';

const validator = await createSchemaValidator();
const MSG_ID = '55555555-5555-5555-5555-555555555555';
const CHUNK_ID = '66666666-6666-6666-6666-666666666666';
const DOC_ID = '77777777-7777-7777-7777-777777777777';
const user = { id: '00000000-0000-0000-0000-000000000001', email: 'ada@example.com' } as unknown as User;

const message: MessageRow = {
  id: MSG_ID,
  chat_id: '44444444-4444-4444-4444-444444444444',
  role: 'assistant',
  content: 'Per [1]…',
  model: 'claude-opus-4-7',
  finish_reason: 'stop',
  input_tokens: 12,
  output_tokens: 30,
  total_tokens: 42,
  cost_usd_micros: null,
  error: null,
  as_of_date: null,
  retrieval_mode: null,
  created_at: '2026-06-08T00:00:00.000Z',
};

const citationRow: MessageCitationRow = {
  id: '88888888-8888-8888-8888-888888888888',
  message_id: MSG_ID,
  chunk_id: CHUNK_ID,
  document_id: DOC_ID,
  index: 0,
  score: 0.87,
  created_at: '2026-06-08T00:00:00.000Z',
};

const ctx = { params: Promise.resolve({ message_id: MSG_ID }) };

beforeEach(() => {
  vi.mocked(getOptionalUser).mockResolvedValue(user);
  vi.mocked(getMessageRow).mockReset();
  vi.mocked(getMessageCitations).mockReset();
});

describe('GET /messages/{id}', () => {
  it('401 when not signed in', async () => {
    vi.mocked(getOptionalUser).mockResolvedValue(null);
    const res = await GET(new Request('http://localhost'), ctx);
    expect(res.status).toBe(401);
  });

  it('404 when absent or RLS-hidden', async () => {
    vi.mocked(getMessageRow).mockResolvedValue(null);
    const res = await GET(new Request('http://localhost'), ctx);
    expect(res.status).toBe(404);
  });

  it('200 with a Message body that includes citations + usage', async () => {
    vi.mocked(getMessageRow).mockResolvedValue(message);
    vi.mocked(getMessageCitations).mockResolvedValue([citationRow]);
    const res = await GET(new Request('http://localhost'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(validator.validate('Message', body).valid, JSON.stringify(body)).toBe(true);
    expect(body.id).toBe(MSG_ID);
    expect(body.citations).toHaveLength(1);
    expect(body.citations[0].chunk_id).toBe(CHUNK_ID);
    expect(body.usage.input_tokens).toBe(12);
    expect(body.finish_reason).toBe('stop');
  });
});
