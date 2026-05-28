// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { runExtraction, extractPdfPages } from './functions/extract';
import { downloadDocumentObject, patchDocumentRow } from './storage';

// Requires a running local Supabase stack (see docs/testing.md). Proves the
// extraction step:
//   - uploads a real PDF to the `documents` bucket
//   - inserts a `documents` row in `pending`
//   - runs the extraction routine with the production deps
//   - observes the row transition to `chunking` with a non-null page_count
//
// Inngest itself isn't exercised here — runExtraction is the pure unit Inngest
// wraps, and exercising the SDK in tests would mean standing up the dev
// server. The route test covers the event-send call.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = 'Password123!';
const HELLO_PDF = readFileSync(join(__dirname, '../../test/fixtures/hello.pdf'));

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

describe('extract pipeline (integration)', () => {
  it('drives a real upload from pending to chunking with page_count', async () => {
    const admin = makeClient(serviceKey);
    const client = await signedInClient(admin, `e-${crypto.randomUUID()}@example.com`);

    const { data: ws } = await client.from('workspaces').select('id').single();
    const { data: u } = await client.auth.getUser();
    expect(ws?.id).toBeDefined();

    const uploadId = crypto.randomUUID();
    const objectKey = `${ws!.id}/${uploadId}.pdf`;

    const upload = await admin.storage.from('documents').upload(objectKey, HELLO_PDF, {
      contentType: 'application/pdf',
    });
    expect(upload.error).toBeNull();

    const insert = await client
      .from('documents')
      .insert({
        workspace_id: ws!.id,
        title: 'hello',
        size_bytes: HELLO_PDF.byteLength,
        content_type: 'application/pdf',
        storage_object_key: objectKey,
        embedding_model: 'text-embedding-3-small',
        uploaded_by: u.user!.id,
      })
      .select('id')
      .single();
    expect(insert.error).toBeNull();
    const documentId = (insert.data as { id: string }).id;

    const result = await runExtraction(
      {
        download: downloadDocumentObject,
        extract: extractPdfPages,
        setState: patchDocumentRow,
      },
      { document_id: documentId, workspace_id: ws!.id, storage_object_key: objectKey },
    );
    expect(result.pageCount).toBe(1);

    const after = await admin
      .from('documents')
      .select('ingestion_state, ingestion_error, page_count')
      .eq('id', documentId)
      .single();
    expect(after.error).toBeNull();
    expect(after.data).toMatchObject({
      ingestion_state: 'chunking',
      ingestion_error: null,
      page_count: 1,
    });
  });
});
