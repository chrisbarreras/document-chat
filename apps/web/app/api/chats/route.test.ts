// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import type { components } from '@document-chat/contracts';
import { createSchemaValidator } from '@document-chat/contracts/test-utils';
import type { ChatRow } from '../../../lib/chats';

vi.mock('../../../lib/auth', () => ({ getOptionalUser: vi.fn() }));
vi.mock('../../../lib/workspace', () => ({ getCurrentWorkspace: vi.fn() }));
vi.mock('../../../lib/chats-store', () => ({
  listChats: vi.fn(),
  insertChat: vi.fn(),
  insertMessage: vi.fn(),
}));

import { getOptionalUser } from '../../../lib/auth';
import { getCurrentWorkspace } from '../../../lib/workspace';
import { insertChat, insertMessage, listChats } from '../../../lib/chats-store';
import { GET, POST } from './route';

const validator = await createSchemaValidator();
const user = { id: '00000000-0000-0000-0000-000000000001', email: 'ada@example.com' } as unknown as User;
const workspace: components['schemas']['Workspace'] = {
  id: '00000000-0000-0000-0000-0000000000aa',
  name: "ada's workspace",
  slug: 'ada',
  created_at: '2026-06-08T00:00:00.000Z',
  updated_at: '2026-06-08T00:00:00.000Z',
};
const CHAT_ID = '44444444-4444-4444-4444-444444444444';

const row: ChatRow = {
  id: CHAT_ID,
  workspace_id: workspace.id,
  user_id: user.id,
  title: 'My chat',
  archived: false,
  last_message_at: null,
  created_at: '2026-06-08T00:00:00.000Z',
  updated_at: '2026-06-08T00:00:00.000Z',
};

function postReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/chats', {
    method: 'POST',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

beforeEach(() => {
  vi.mocked(getOptionalUser).mockResolvedValue(user);
  vi.mocked(getCurrentWorkspace).mockResolvedValue(workspace);
  vi.mocked(listChats).mockReset();
  vi.mocked(insertChat).mockReset();
  vi.mocked(insertMessage).mockReset();
  vi.mocked(listChats).mockResolvedValue({ items: [row], nextCursor: null });
  vi.mocked(insertChat).mockResolvedValue(row);
  vi.mocked(insertMessage).mockResolvedValue(null);
});

describe('GET /chats', () => {
  it('401 when not signed in', async () => {
    vi.mocked(getOptionalUser).mockResolvedValue(null);
    const res = await GET(new Request('http://localhost/api/chats'));
    expect(res.status).toBe(401);
  });

  it('400 on an out-of-range limit', async () => {
    const res = await GET(new Request('http://localhost/api/chats?limit=999'));
    expect(res.status).toBe(400);
  });

  it('200 with a PaginatedChats body', async () => {
    vi.mocked(listChats).mockResolvedValue({ items: [row], nextCursor: 'next' });
    const res = await GET(new Request('http://localhost/api/chats?limit=5&archived=false'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(validator.validate('PaginatedChats', body).valid, JSON.stringify(body)).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.page.next_cursor).toBe('next');
  });

  it('propagates the archived filter to the store', async () => {
    await GET(new Request('http://localhost/api/chats?archived=true'));
    expect(listChats).toHaveBeenCalledWith(
      expect.objectContaining({ archived: true, workspaceId: workspace.id }),
    );
  });
});

describe('POST /chats', () => {
  it('401 when not signed in', async () => {
    vi.mocked(getOptionalUser).mockResolvedValue(null);
    const res = await POST(postReq({}));
    expect(res.status).toBe(401);
  });

  it('503 when streaming is requested', async () => {
    const res = await POST(postReq({}, { accept: 'text/event-stream' }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('streaming.not_available');
  });

  it('201 with a Chat body when no body is provided', async () => {
    const res = await POST(
      new Request('http://localhost/api/chats', { method: 'POST' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(validator.validate('Chat', body).valid, JSON.stringify(body)).toBe(true);
  });

  it('persists the user first_message when provided', async () => {
    await POST(postReq({ first_message: { content: 'hello' } }));
    expect(insertMessage).toHaveBeenCalledWith({
      chatId: row.id,
      role: 'user',
      content: 'hello',
    });
  });

  it('422 when first_message carries a Tier 3+ as_of_date', async () => {
    const res = await POST(
      postReq({ first_message: { content: 'hi', as_of_date: '2026-01-01' } }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('feature.not_available');
  });

  it('422 when first_message carries Tier 4+ retrieval options', async () => {
    const res = await POST(
      postReq({ first_message: { content: 'hi', retrieval: { mode: 'hybrid' } } }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('feature.not_available');
  });

  it('400 when first_message.content is empty', async () => {
    const res = await POST(postReq({ first_message: { content: '   ' } }));
    expect(res.status).toBe(400);
  });
});
