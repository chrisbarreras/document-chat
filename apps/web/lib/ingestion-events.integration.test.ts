// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { recordIngestionTransition } from './inngest/storage';

// Requires a running local Supabase stack (see docs/testing.md). Pins the
// `ingestion_events` write path and the cascade-on-document-delete behavior.

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

async function seedDocument(
  admin: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<string> {
  const { data, error } = await admin
    .from('documents')
    .insert({
      workspace_id: workspaceId,
      title: 'doc',
      size_bytes: 1024,
      content_type: 'application/pdf',
      storage_object_key: `${workspaceId}/${crypto.randomUUID()}.pdf`,
      embedding_model: 'text-embedding-3-small',
      uploaded_by: userId,
    })
    .select('id')
    .single();
  expect(error).toBeNull();
  return (data as { id: string }).id;
}

describe('ingestion_events (integration)', () => {
  it('records a row for each state transition and updates the documents row', async () => {
    const admin = makeClient(serviceKey);
    const client = await signedInClient(admin, `ie-${crypto.randomUUID()}@example.com`);
    const { data: ws } = await client.from('workspaces').select('id').single();
    const { data: u } = await client.auth.getUser();

    const documentId = await seedDocument(admin, ws!.id, u.user!.id);

    await recordIngestionTransition(documentId, 'extracting', { ingestionError: null });
    await recordIngestionTransition(documentId, 'chunking', { pageCount: 3 });
    await recordIngestionTransition(documentId, 'ready');

    const { data: events } = await admin
      .from('ingestion_events')
      .select('event, from_state, to_state')
      .eq('document_id', documentId)
      .order('occurred_at', { ascending: true })
      .order('id', { ascending: true });
    expect(events).toHaveLength(3);
    expect((events![0] as { to_state: string }).to_state).toBe('extracting');
    expect((events![1] as { to_state: string }).to_state).toBe('chunking');
    expect((events![2] as { to_state: string }).to_state).toBe('ready');

    const { data: doc } = await admin
      .from('documents')
      .select('ingestion_state, ingestion_error, page_count')
      .eq('id', documentId)
      .single();
    expect(doc).toMatchObject({
      ingestion_state: 'ready',
      ingestion_error: null,
      page_count: 3,
    });
  });

  it('records a failed event with the error message', async () => {
    const admin = makeClient(serviceKey);
    const client = await signedInClient(admin, `if-${crypto.randomUUID()}@example.com`);
    const { data: ws } = await client.from('workspaces').select('id').single();
    const { data: u } = await client.auth.getUser();
    const documentId = await seedDocument(admin, ws!.id, u.user!.id);

    await recordIngestionTransition(documentId, 'failed', {
      ingestionError: 'boom',
    });

    const { data: events } = await admin
      .from('ingestion_events')
      .select('event')
      .eq('document_id', documentId);
    expect(events).toHaveLength(1);
    expect((events![0] as { event: string }).event).toBe('failed');

    const { data: doc } = await admin
      .from('documents')
      .select('ingestion_state, ingestion_error')
      .eq('id', documentId)
      .single();
    expect(doc).toMatchObject({
      ingestion_state: 'failed',
      ingestion_error: 'boom',
    });
  });

  it('cascades event rows when the parent document is deleted', async () => {
    const admin = makeClient(serviceKey);
    const client = await signedInClient(admin, `ic-${crypto.randomUUID()}@example.com`);
    const { data: ws } = await client.from('workspaces').select('id').single();
    const { data: u } = await client.auth.getUser();
    const documentId = await seedDocument(admin, ws!.id, u.user!.id);

    await recordIngestionTransition(documentId, 'extracting');
    await recordIngestionTransition(documentId, 'ready');
    await admin.from('documents').delete().eq('id', documentId);

    const { data: leftover } = await admin
      .from('ingestion_events')
      .select('id')
      .eq('document_id', documentId);
    expect(leftover).toHaveLength(0);
  });

  it('RLS hides one user\'s events from another', async () => {
    const admin = makeClient(serviceKey);
    const clientA = await signedInClient(admin, `ia-${crypto.randomUUID()}@example.com`);
    const clientB = await signedInClient(admin, `ib-${crypto.randomUUID()}@example.com`);
    const { data: wsA } = await clientA.from('workspaces').select('id').single();
    const { data: userA } = await clientA.auth.getUser();
    const documentId = await seedDocument(admin, wsA!.id, userA.user!.id);
    await recordIngestionTransition(documentId, 'extracting');

    const { data: aEvents } = await clientA.from('ingestion_events').select('id').eq('document_id', documentId);
    expect(aEvents).toHaveLength(1);

    const { data: bEvents } = await clientB.from('ingestion_events').select('id').eq('document_id', documentId);
    expect(bEvents).toHaveLength(0);
  });
});
