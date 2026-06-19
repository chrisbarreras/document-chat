// SPDX-License-Identifier: Apache-2.0
// Shared helpers for store integration tests. These create real users against
// the local Supabase stack and seed rows, so the store functions can run their
// real RLS-scoped queries (see docs/testing-integration-plan.md). Requires a
// running local Supabase (env from .env.test).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { expect } from 'vitest';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = 'Password123!';

export function makeClient(key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // supabase-js eagerly constructs a Realtime client needing a WebSocket;
    // Node < 22 has none global, so supply `ws`. We never open a connection.
    realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
  });
}

export const adminClient = (): SupabaseClient => makeClient(serviceKey);
export const anonClient = (): SupabaseClient => makeClient(anonKey);
export const uniqueEmail = (prefix = 'u'): string => `${prefix}-${crypto.randomUUID()}@example.com`;

export interface TestUser {
  client: SupabaseClient;
  userId: string;
  workspaceId: string;
}

/**
 * Create a confirmed user, sign them in, and resolve their auto-provisioned
 * workspace. Returns an RLS-scoped client plus the user/workspace ids.
 */
export async function signedInUser(admin: SupabaseClient, prefix = 'u'): Promise<TestUser> {
  const email = uniqueEmail(prefix);
  const { error: createErr } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  expect(createErr).toBeNull();

  const client = anonClient();
  const { data: signIn, error: signInErr } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  expect(signInErr).toBeNull();

  // Workspace auto-provisions on signup (DB trigger); RLS scopes the row to us.
  const { data: ws, error: wsErr } = await client.from('workspaces').select('id').single();
  expect(wsErr).toBeNull();

  return { client, userId: signIn.user!.id, workspaceId: (ws as { id: string }).id };
}

/** Insert a document via the given (RLS-scoped) client. Returns its id. */
export async function seedDocument(
  client: SupabaseClient,
  opts: { workspaceId: string; userId: string; title?: string; status?: 'draft' | 'current' | 'retired' },
): Promise<string> {
  const { data, error } = await client
    .from('documents')
    .insert({
      workspace_id: opts.workspaceId,
      title: opts.title ?? 'Doc',
      status: opts.status ?? 'current',
      size_bytes: 1024,
      content_type: 'application/pdf',
      storage_object_key: `${opts.workspaceId}/${crypto.randomUUID()}.pdf`,
      embedding_model: 'text-embedding-3-small',
      uploaded_by: opts.userId,
    })
    .select('id')
    .single();
  expect(error).toBeNull();
  return (data as { id: string }).id;
}

/**
 * Seed `n` chunk rows for a document via the admin client (mirrors how the
 * Inngest pipeline writes them). Embeddings are nullable, so we skip them.
 * Returns the chunk ids in index order.
 */
export async function seedChunks(
  admin: SupabaseClient,
  documentId: string,
  n: number,
): Promise<string[]> {
  const rows = Array.from({ length: n }, (_, i) => ({
    document_id: documentId,
    index: i,
    text: `chunk ${i}`,
    token_count: 5,
    embedding_model: 'text-embedding-3-small',
    char_start: i * 100,
    char_end: i * 100 + 99,
    page_number: 1,
  }));
  const { data, error } = await admin.from('chunks').insert(rows).select('id, index').order('index');
  expect(error).toBeNull();
  return (data as { id: string }[]).map((r) => r.id);
}
