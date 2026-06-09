// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

// Requires a running local Supabase stack (see docs/testing.md). Pins the
// Tier 1 chat schema: a user can CRUD chats + messages + citations within
// their workspace; RLS hides everything else.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = 'Password123!';

function makeClient(key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
  });
}

async function signedInClient(admin: SupabaseClient, email: string): Promise<SupabaseClient> {
  const { error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  expect(error).toBeNull();
  const client = makeClient(anonKey);
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  expect(signInErr).toBeNull();
  return client;
}

describe('chats / messages / citations (integration: RLS isolation)', () => {
  it('hides one user\'s chats from another', async () => {
    const admin = makeClient(serviceKey);
    const clientA = await signedInClient(admin, `ca-${crypto.randomUUID()}@example.com`);
    const clientB = await signedInClient(admin, `cb-${crypto.randomUUID()}@example.com`);

    const { data: wsA } = await clientA.from('workspaces').select('id').single();
    const { data: userA } = await clientA.auth.getUser();

    const insert = await clientA
      .from('chats')
      .insert({
        workspace_id: wsA!.id,
        user_id: userA.user!.id,
        title: "A's private chat",
      })
      .select('id')
      .single();
    expect(insert.error).toBeNull();
    const chatId = (insert.data as { id: string }).id;

    const { data: aRows } = await clientA.from('chats').select('id');
    expect(aRows).toHaveLength(1);

    const { data: bRows, error: bErr } = await clientB.from('chats').select('id');
    expect(bErr).toBeNull();
    expect(bRows).toHaveLength(0);

    // B can't see A's chat by id either.
    const { data: byId } = await clientB.from('chats').select('id').eq('id', chatId).maybeSingle();
    expect(byId).toBeNull();
  });

  it('cascades message + citation deletes when a chat is deleted, and bumps last_message_at on insert', async () => {
    const admin = makeClient(serviceKey);
    const client = await signedInClient(admin, `cc-${crypto.randomUUID()}@example.com`);
    const { data: ws } = await client.from('workspaces').select('id').single();
    const { data: u } = await client.auth.getUser();

    const { data: chat } = await client
      .from('chats')
      .insert({
        workspace_id: ws!.id,
        user_id: u.user!.id,
        title: 'cascade test',
      })
      .select('id, last_message_at')
      .single();
    expect((chat as { last_message_at: string | null }).last_message_at).toBeNull();
    const chatId = (chat as { id: string }).id;

    const { data: msg, error: msgErr } = await client
      .from('messages')
      .insert({ chat_id: chatId, role: 'user', content: 'hello' })
      .select('id, created_at')
      .single();
    expect(msgErr).toBeNull();
    const messageId = (msg as { id: string }).id;

    // Trigger bumped last_message_at on the parent chat.
    const { data: chatAfter } = await client
      .from('chats')
      .select('last_message_at')
      .eq('id', chatId)
      .single();
    expect((chatAfter as { last_message_at: string | null }).last_message_at).not.toBeNull();

    const { error: citErr } = await client.from('citations').insert({
      message_id: messageId,
      chunk_id: crypto.randomUUID(),
      document_id: crypto.randomUUID(),
      index: 0,
    });
    expect(citErr).toBeNull();

    // Delete the chat — messages + citations should cascade.
    const { error: delErr } = await client.from('chats').delete().eq('id', chatId);
    expect(delErr).toBeNull();

    const { data: leftoverMsgs } = await admin.from('messages').select('id').eq('id', messageId);
    expect(leftoverMsgs).toHaveLength(0);

    const { data: leftoverCits } = await admin
      .from('citations')
      .select('id')
      .eq('message_id', messageId);
    expect(leftoverCits).toHaveLength(0);
  });
});
