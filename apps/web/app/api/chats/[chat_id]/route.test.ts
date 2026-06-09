// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { createSchemaValidator } from '@document-chat/contracts/test-utils';
import type { ChatRow } from '../../../../lib/chats';

vi.mock('../../../../lib/auth', () => ({ getOptionalUser: vi.fn() }));
vi.mock('../../../../lib/chats-store', () => ({
  getChatRow: vi.fn(),
  updateChatRow: vi.fn(),
  deleteChatRow: vi.fn(),
}));

import { getOptionalUser } from '../../../../lib/auth';
import { deleteChatRow, getChatRow, updateChatRow } from '../../../../lib/chats-store';
import { GET, PATCH, DELETE } from './route';

const validator = await createSchemaValidator();
const CHAT_ID = '44444444-4444-4444-4444-444444444444';
const user = { id: '00000000-0000-0000-0000-000000000001', email: 'ada@example.com' } as unknown as User;

const row: ChatRow = {
  id: CHAT_ID,
  workspace_id: '00000000-0000-0000-0000-0000000000aa',
  user_id: user.id,
  title: 'My chat',
  archived: false,
  last_message_at: null,
  created_at: '2026-06-08T00:00:00.000Z',
  updated_at: '2026-06-08T00:00:00.000Z',
};

const ctx = { params: Promise.resolve({ chat_id: CHAT_ID }) };

function patchReq(body: unknown): Request {
  return new Request(`http://localhost/api/chats/${CHAT_ID}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.mocked(getOptionalUser).mockResolvedValue(user);
  vi.mocked(getChatRow).mockReset();
  vi.mocked(updateChatRow).mockReset();
  vi.mocked(deleteChatRow).mockReset();
});

describe('GET /chats/{id}', () => {
  it('404 when absent or not owned', async () => {
    vi.mocked(getChatRow).mockResolvedValue(null);
    const res = await GET(new Request('http://localhost'), ctx);
    expect(res.status).toBe(404);
  });

  it('200 with a Chat body', async () => {
    vi.mocked(getChatRow).mockResolvedValue(row);
    const res = await GET(new Request('http://localhost'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(validator.validate('Chat', body).valid, JSON.stringify(body)).toBe(true);
    expect(body.id).toBe(CHAT_ID);
  });
});

describe('PATCH /chats/{id}', () => {
  it('400 when no fields are provided', async () => {
    const res = await PATCH(patchReq({}), ctx);
    expect(res.status).toBe(400);
  });

  it('400 on an empty title', async () => {
    const res = await PATCH(patchReq({ title: '   ' }), ctx);
    expect(res.status).toBe(400);
  });

  it('422 on a too-long title', async () => {
    const res = await PATCH(patchReq({ title: 'x'.repeat(201) }), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('chat.title_too_long');
  });

  it('404 when the chat is absent', async () => {
    vi.mocked(updateChatRow).mockResolvedValue(null);
    const res = await PATCH(patchReq({ title: 'New' }), ctx);
    expect(res.status).toBe(404);
  });

  it('200 with the updated Chat', async () => {
    vi.mocked(updateChatRow).mockResolvedValue({ ...row, title: 'Renamed' });
    const res = await PATCH(patchReq({ title: 'Renamed' }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(validator.validate('Chat', body).valid).toBe(true);
    expect(body.title).toBe('Renamed');
  });

  it('200 when archiving', async () => {
    vi.mocked(updateChatRow).mockResolvedValue({ ...row, archived: true });
    const res = await PATCH(patchReq({ archived: true }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).archived).toBe(true);
  });
});

describe('DELETE /chats/{id}', () => {
  it('404 when nothing was deleted', async () => {
    vi.mocked(deleteChatRow).mockResolvedValue(false);
    const res = await DELETE(new Request('http://localhost'), ctx);
    expect(res.status).toBe(404);
  });

  it('204 on success', async () => {
    vi.mocked(deleteChatRow).mockResolvedValue(true);
    const res = await DELETE(new Request('http://localhost'), ctx);
    expect(res.status).toBe(204);
  });
});
