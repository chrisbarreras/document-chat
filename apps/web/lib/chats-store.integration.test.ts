// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { adminClient, signedInUser, type TestUser } from '../test/integration-helpers';

vi.mock('./supabase/server', () => ({ createSSRClient: vi.fn() }));
vi.mock('./supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createSSRClient } from './supabase/server';
import { createAdminClient } from './supabase/admin';
import {
  listChats,
  insertChat,
  getChatRow,
  updateChatRow,
  deleteChatRow,
  listChatMessages,
  insertMessage,
  getMessageRow,
  getMessageCitations,
  getCitationsForMessages,
  persistAssistantMessage,
} from './chats-store';

const admin = adminClient();
let alice: TestUser;
let bob: TestUser;

function asUser(u: TestUser): void {
  vi.mocked(createSSRClient).mockResolvedValue(u.client as never);
}

async function newChat(u: TestUser, title = 'My chat') {
  asUser(u);
  const chat = await insertChat({ workspaceId: u.workspaceId, userId: u.userId, title });
  expect(chat).not.toBeNull();
  return chat!;
}

beforeAll(async () => {
  vi.mocked(createAdminClient).mockReturnValue(admin as never);
  alice = await signedInUser(admin, 'alice');
  bob = await signedInUser(admin, 'bob');
});

describe('chats-store (integration)', () => {
  it('creates, reads, updates, lists, and deletes a chat', async () => {
    const chat = await newChat(alice, 'Original');
    expect((await getChatRow(chat.id))?.title).toBe('Original');

    expect((await updateChatRow(chat.id, { title: 'Renamed' }))?.title).toBe('Renamed');

    const list = await listChats({ workspaceId: alice.workspaceId, limit: 50 });
    expect(list.items.some((c) => c.id === chat.id)).toBe(true);

    expect(await deleteChatRow(chat.id)).toBe(true);
    expect(await getChatRow(chat.id)).toBeNull();
  });

  it('inserts and reads messages', async () => {
    const chat = await newChat(alice);
    const msg = await insertMessage({ chatId: chat.id, role: 'user', content: 'hello' });
    expect(msg).not.toBeNull();
    expect((await getMessageRow(msg!.id))?.content).toBe('hello');

    const list = await listChatMessages({ chatId: chat.id, limit: 50 });
    expect(list.items.some((m) => m.id === msg!.id)).toBe(true);
  });

  it('persists an assistant message with citations (admin) and reads them back', async () => {
    const chat = await newChat(alice);
    const messageId = crypto.randomUUID();
    const persisted = await persistAssistantMessage({
      messageId,
      chatId: chat.id,
      content: 'the answer',
      model: 'claude-test',
      finishReason: 'stop',
      inputTokens: 10,
      outputTokens: 5,
      citations: [
        { chunkId: crypto.randomUUID(), documentId: crypto.randomUUID(), score: 0.91, index: 0 },
      ],
    });
    expect(persisted?.message.id).toBe(messageId);
    expect(persisted?.message.total_tokens).toBe(15);
    expect(persisted?.citations).toHaveLength(1);

    asUser(alice);
    expect(await getMessageCitations(messageId)).toHaveLength(1);

    const map = await getCitationsForMessages([messageId]);
    expect(map.get(messageId)).toHaveLength(1);
    expect((await getCitationsForMessages([])).size).toBe(0);
  });

  it('persists an assistant message with no citations', async () => {
    const chat = await newChat(alice);
    const persisted = await persistAssistantMessage({
      messageId: crypto.randomUUID(),
      chatId: chat.id,
      content: 'no sources',
      model: 'claude-test',
      finishReason: 'stop',
      inputTokens: 3,
      outputTokens: 2,
      citations: [],
    });
    expect(persisted?.citations).toHaveLength(0);
  });

  it('scopes chats by RLS', async () => {
    const chat = await newChat(alice, 'Alice only');
    asUser(bob);
    expect(await getChatRow(chat.id)).toBeNull();
    expect(await deleteChatRow(chat.id)).toBe(false);
    expect((await listChats({ workspaceId: alice.workspaceId, limit: 50 })).items).toHaveLength(0);
  });
});
