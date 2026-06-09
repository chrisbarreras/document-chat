// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { createSchemaValidator } from '@document-chat/contracts/test-utils';
import type { ChatRow, MessageRow } from '../../../../../lib/chats';

vi.mock('../../../../../lib/auth', () => ({ getOptionalUser: vi.fn() }));
vi.mock('../../../../../lib/chats-store', () => ({
  getChatRow: vi.fn(),
  listChatMessages: vi.fn(),
  insertMessage: vi.fn(),
  getCitationsForMessages: vi.fn(),
}));

import { getOptionalUser } from '../../../../../lib/auth';
import {
  getChatRow,
  getCitationsForMessages,
  insertMessage,
  listChatMessages,
} from '../../../../../lib/chats-store';
import { GET, POST } from './route';

const validator = await createSchemaValidator();
const CHAT_ID = '44444444-4444-4444-4444-444444444444';
const MSG_ID = '55555555-5555-5555-5555-555555555555';
const user = { id: '00000000-0000-0000-0000-000000000001', email: 'ada@example.com' } as unknown as User;

const chat: ChatRow = {
  id: CHAT_ID,
  workspace_id: '00000000-0000-0000-0000-0000000000aa',
  user_id: user.id,
  title: 'My chat',
  archived: false,
  last_message_at: null,
  created_at: '2026-06-08T00:00:00.000Z',
  updated_at: '2026-06-08T00:00:00.000Z',
};

const message: MessageRow = {
  id: MSG_ID,
  chat_id: CHAT_ID,
  role: 'user',
  content: 'Hello',
  model: null,
  finish_reason: null,
  input_tokens: null,
  output_tokens: null,
  total_tokens: null,
  cost_usd_micros: null,
  error: null,
  as_of_date: null,
  retrieval_mode: null,
  created_at: '2026-06-08T00:00:00.000Z',
};

const ctx = { params: Promise.resolve({ chat_id: CHAT_ID }) };

function postReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/chats/${CHAT_ID}/messages`, {
    method: 'POST',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

beforeEach(() => {
  vi.mocked(getOptionalUser).mockResolvedValue(user);
  vi.mocked(getChatRow).mockReset();
  vi.mocked(listChatMessages).mockReset();
  vi.mocked(insertMessage).mockReset();
  vi.mocked(getCitationsForMessages).mockReset();
  vi.mocked(getChatRow).mockResolvedValue(chat);
  vi.mocked(listChatMessages).mockResolvedValue({ items: [message], nextCursor: null });
  vi.mocked(insertMessage).mockResolvedValue(message);
  vi.mocked(getCitationsForMessages).mockResolvedValue(new Map());
});

describe('GET /chats/{id}/messages', () => {
  it('401 when not signed in', async () => {
    vi.mocked(getOptionalUser).mockResolvedValue(null);
    const res = await GET(new Request('http://localhost'), ctx);
    expect(res.status).toBe(401);
  });

  it('404 when the chat is absent or not owned', async () => {
    vi.mocked(getChatRow).mockResolvedValue(null);
    const res = await GET(new Request('http://localhost'), ctx);
    expect(res.status).toBe(404);
  });

  it('200 with a PaginatedMessages body', async () => {
    const res = await GET(
      new Request(`http://localhost/api/chats/${CHAT_ID}/messages?limit=5`),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(validator.validate('PaginatedMessages', body).valid, JSON.stringify(body)).toBe(true);
    expect(body.items).toHaveLength(1);
  });
});

describe('POST /chats/{id}/messages', () => {
  it('401 when not signed in', async () => {
    vi.mocked(getOptionalUser).mockResolvedValue(null);
    const res = await POST(postReq({ content: 'hi' }), ctx);
    expect(res.status).toBe(401);
  });

  it('503 when streaming is requested', async () => {
    const res = await POST(postReq({ content: 'hi' }, { accept: 'text/event-stream' }), ctx);
    expect(res.status).toBe(503);
  });

  it('404 when the chat is absent', async () => {
    vi.mocked(getChatRow).mockResolvedValue(null);
    const res = await POST(postReq({ content: 'hi' }), ctx);
    expect(res.status).toBe(404);
  });

  it('400 when content is empty', async () => {
    const res = await POST(postReq({ content: '   ' }), ctx);
    expect(res.status).toBe(400);
  });

  it('422 when content is too long', async () => {
    const res = await POST(postReq({ content: 'x'.repeat(32_001) }), ctx);
    expect(res.status).toBe(422);
  });

  it('422 on Tier 3 as_of_date', async () => {
    const res = await POST(postReq({ content: 'hi', as_of_date: '2026-01-01' }), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('feature.not_available');
  });

  it('200 with a Message body on success', async () => {
    const res = await POST(postReq({ content: 'hi' }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(validator.validate('Message', body).valid, JSON.stringify(body)).toBe(true);
    expect(body.role).toBe('user');
    expect(insertMessage).toHaveBeenCalledWith({
      chatId: CHAT_ID,
      role: 'user',
      content: 'hi',
    });
  });
});
