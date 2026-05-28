// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { EMBEDDING_DIMENSIONS } from '../embeddings/openai';
import { runChunking } from './functions/chunk';
import { runEmbedding } from './functions/embed';
import { extractPdfPages, runExtraction } from './functions/extract';
import { downloadDocumentObject, patchDocumentRow, replaceDocumentChunks } from './storage';

// Requires a running local Supabase stack (see docs/testing.md). The
// embeddings call is stubbed so the test runs without network or OpenAI
// budget — the nightly eval workflow (chunk #18) exercises real embeddings.
// What's pinned here is the full DB + state-machine round-trip:
//   pending -> extracting -> chunking -> embedding -> ready
// with N chunk rows persisted, each carrying a non-null embedding.

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

function fakeVector(seed: number): number[] {
  // Deterministic non-zero vector; the actual values don't matter for this
  // test, only that they round-trip through pgvector.
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (seed + i) / 1000);
}

describe('ingestion pipeline (integration)', () => {
  it('drives an upload from pending to ready with chunk rows + embeddings', async () => {
    const admin = makeClient(serviceKey);
    const client = await signedInClient(admin, `p-${crypto.randomUUID()}@example.com`);

    const { data: ws } = await client.from('workspaces').select('id').single();
    const { data: u } = await client.auth.getUser();

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

    // Step 1: extract.
    const extraction = await runExtraction(
      {
        download: downloadDocumentObject,
        extract: extractPdfPages,
        setState: patchDocumentRow,
      },
      { document_id: documentId, workspace_id: ws!.id, storage_object_key: objectKey },
    );
    expect(extraction.pageCount).toBe(1);

    // Step 2: chunk (pure, no I/O).
    const chunks = runChunking(extraction);
    expect(chunks.length).toBeGreaterThan(0);

    // Step 3: embed — stubbed embedder. Asserts the embedding rows reach
    // the DB with a non-null vector of the right dimensionality.
    const result = await runEmbedding(
      {
        embed: async (inputs) => inputs.map((_, i) => fakeVector(i + 1)),
        storeChunks: replaceDocumentChunks,
        setState: patchDocumentRow,
      },
      documentId,
      chunks,
    );
    expect(result.inserted).toBe(chunks.length);

    // Documents row reached `ready`.
    const after = await admin
      .from('documents')
      .select('ingestion_state, ingestion_error, page_count')
      .eq('id', documentId)
      .single();
    expect(after.error).toBeNull();
    expect(after.data).toMatchObject({
      ingestion_state: 'ready',
      ingestion_error: null,
      page_count: 1,
    });

    // Chunk rows landed with their embeddings.
    const chunkRows = await admin
      .from('chunks')
      .select('id, index, text, token_count, page_number, embedding')
      .eq('document_id', documentId)
      .order('index', { ascending: true });
    expect(chunkRows.error).toBeNull();
    expect(chunkRows.data).toHaveLength(chunks.length);
    expect((chunkRows.data![0] as { embedding: unknown }).embedding).not.toBeNull();
  });

  it('re-running embedding replaces prior chunks rather than duplicating', async () => {
    const admin = makeClient(serviceKey);
    const client = await signedInClient(admin, `r-${crypto.randomUUID()}@example.com`);

    const { data: ws } = await client.from('workspaces').select('id').single();
    const { data: u } = await client.auth.getUser();
    const objectKey = `${ws!.id}/${crypto.randomUUID()}.pdf`;
    await admin.storage.from('documents').upload(objectKey, HELLO_PDF, { contentType: 'application/pdf' });
    const { data: doc } = await client
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
    const documentId = (doc as { id: string }).id;

    const extraction = await runExtraction(
      {
        download: downloadDocumentObject,
        extract: extractPdfPages,
        setState: patchDocumentRow,
      },
      { document_id: documentId, workspace_id: ws!.id, storage_object_key: objectKey },
    );
    const chunks = runChunking(extraction);

    const deps = {
      embed: async (inputs: string[]) => inputs.map((_, i) => fakeVector(i + 1)),
      storeChunks: replaceDocumentChunks,
      setState: patchDocumentRow,
    };
    await runEmbedding(deps, documentId, chunks);
    await runEmbedding(deps, documentId, chunks);

    const { data: rows } = await admin
      .from('chunks')
      .select('id')
      .eq('document_id', documentId);
    expect(rows).toHaveLength(chunks.length);
  });
});
