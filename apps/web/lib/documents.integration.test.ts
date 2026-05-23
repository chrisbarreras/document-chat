// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

// Requires a running local Supabase stack with the env vars (see
// docs/testing.md). Proves RLS isolation on documents: a user can insert a
// document into their own workspace, and another user cannot see it.

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
  const { error: createErr } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  expect(createErr).toBeNull();
  const client = makeClient(anonKey);
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  expect(signInErr).toBeNull();
  return client;
}

describe('documents (integration: RLS isolation)', () => {
  it('hides one user\'s documents from another', async () => {
    const admin = makeClient(serviceKey);
    const clientA = await signedInClient(admin, `a-${crypto.randomUUID()}@example.com`);
    const clientB = await signedInClient(admin, `b-${crypto.randomUUID()}@example.com`);

    // A's auto-provisioned workspace.
    const { data: wsA } = await clientA.from('workspaces').select('id').single();
    const { data: userA } = await clientA.auth.getUser();

    // A inserts a document into A's workspace (RLS check passes).
    const { error: insertErr } = await clientA.from('documents').insert({
      workspace_id: wsA!.id,
      title: 'A private doc',
      size_bytes: 1024,
      content_type: 'application/pdf',
      storage_object_key: `uploads/${crypto.randomUUID()}.pdf`,
      embedding_model: 'text-embedding-3-small',
      uploaded_by: userA.user!.id,
    });
    expect(insertErr).toBeNull();

    // A sees it; B sees nothing.
    const { data: aDocs } = await clientA.from('documents').select('id, title');
    expect(aDocs).toHaveLength(1);

    const { data: bDocs, error: bErr } = await clientB.from('documents').select('id, title');
    expect(bErr).toBeNull();
    expect(bDocs).toHaveLength(0);
  });

  it('paginates with the same order + range listDocuments uses', async () => {
    const admin = makeClient(serviceKey);
    const client = await signedInClient(admin, `p-${crypto.randomUUID()}@example.com`);
    const { data: ws } = await client.from('workspaces').select('id').single();
    const { data: u } = await client.auth.getUser();

    for (let i = 0; i < 3; i++) {
      const { error } = await client.from('documents').insert({
        workspace_id: ws!.id,
        title: `Doc ${i}`,
        size_bytes: 100 + i,
        content_type: 'application/pdf',
        storage_object_key: `${ws!.id}/${crypto.randomUUID()}.pdf`,
        embedding_model: 'text-embedding-3-small',
        uploaded_by: u.user!.id,
      });
      expect(error).toBeNull();
    }

    // listDocuments fetches range(offset, offset + limit) — one extra row past
    // the limit to detect a next page. With limit=2 and 3 docs: page 1 returns
    // 3 (2 shown + 1 sentinel), page 2 returns the last 1.
    const page1 = await client
      .from('documents')
      .select('id')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(0, 2);
    expect(page1.error).toBeNull();
    expect(page1.data).toHaveLength(3);

    const page2 = await client
      .from('documents')
      .select('id')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(2, 4);
    expect(page2.error).toBeNull();
    expect(page2.data).toHaveLength(1);
  });
});
