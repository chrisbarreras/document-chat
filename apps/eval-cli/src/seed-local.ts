// SPDX-License-Identifier: Apache-2.0
//
// Local-only seeder for live-mode eval. In CI the golden corpus is uploaded
// by a separate seeder workflow against a deployed environment; this script
// is the local equivalent so a developer can run `eval-cli` in live mode
// against the local Supabase stack.
//
// What it does (all via the service-role client, bypassing the PDF/Inngest
// ingestion path for determinism):
//
//   1. Cleans up any prior eval user (email `eval-seed@…` or `eval+…`), which
//      cascade-deletes its workspace, documents, and chunks.
//   2. Creates a fresh auth user. The `on_auth_user_created` trigger
//      auto-provisions exactly one workspace for it.
//   3. Renames the user's email to `eval+<ownerId>@example.com` — the exact
//      address the live client mints a magic-link token for (see live.ts).
//   4. For each corpus document, inserts a `documents` row and one `chunks`
//      row per page, embedding the page text with the SAME model the eval's
//      query side uses (text-embedding-3-small) so cosine similarity is valid.
//   5. Writes the document map { corpusDocId: { chunkSlug: chunkUuid } } to
//      the path in EVAL_DOCUMENT_MAP, and prints the EVAL_WORKSPACE_ID.
//
// Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// OPENAI_API_KEY, EVAL_DOCUMENT_MAP (output path).

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { EMBEDDING_MODEL, embedTexts } from '@document-chat/retrieval';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, '..', '..', '..', 'packages', 'eval', 'fixtures');

interface CorpusDoc {
  id: string;
  title: string;
  chunkSlugs: string[];
  pages: string[];
}

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

async function main(): Promise<void> {
  const supabaseUrl = envOrThrow('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = envOrThrow('SUPABASE_SERVICE_ROLE_KEY');
  envOrThrow('OPENAI_API_KEY'); // consumed by embedTexts
  const mapPath = envOrThrow('EVAL_DOCUMENT_MAP');

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const corpusRaw = await readFile(resolve(FIXTURES, 'corpus.json'), 'utf8');
  const corpus = (JSON.parse(corpusRaw) as { documents: CorpusDoc[] }).documents;

  // 1. Clean up prior eval users (cascade removes their workspace/docs/chunks).
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw new Error(`listUsers failed: ${listErr.message}`);
  for (const u of list.users) {
    if (u.email && /^eval(-seed|\+)/.test(u.email)) {
      await admin.auth.admin.deleteUser(u.id);
    }
  }

  // 2. Create the eval user; the on_auth_user_created trigger provisions a
  //    workspace for it.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: 'eval-seed@example.com',
    email_confirm: true,
  });
  if (createErr) throw new Error(`createUser failed: ${createErr.message}`);
  const ownerId = created.user.id;

  // 3. Rename to the address the live client mints a token for.
  const ownerEmail = `eval+${ownerId}@example.com`;
  const { error: updErr } = await admin.auth.admin.updateUserById(ownerId, {
    email: ownerEmail,
    email_confirm: true,
  });
  if (updErr) throw new Error(`email rename failed: ${updErr.message}`);

  // Fetch the auto-provisioned workspace.
  const { data: ws, error: wsErr } = await admin
    .from('workspaces')
    .select('id')
    .eq('owner_id', ownerId)
    .single();
  if (wsErr) throw new Error(`workspace lookup failed: ${wsErr.message}`);
  const workspaceId = (ws as { id: string }).id;

  // 4. Insert documents + embedded chunks.
  const documentMap: Record<string, Record<string, string>> = {};

  for (const doc of corpus) {
    const { data: docRow, error: docErr } = await admin
      .from('documents')
      .insert({
        workspace_id: workspaceId,
        title: doc.title,
        version: '1.0',
        status: 'current',
        ingestion_state: 'ready',
        content_type: 'application/pdf',
        storage_object_key: `eval/${doc.id}.pdf`,
        embedding_model: EMBEDDING_MODEL,
        size_bytes: doc.pages.reduce((n, p) => n + Buffer.byteLength(p, 'utf8'), 0),
        page_count: doc.pages.length,
        uploaded_by: ownerId,
      })
      .select('id')
      .single();
    if (docErr) throw new Error(`insert document ${doc.id} failed: ${docErr.message}`);
    const documentId = (docRow as { id: string }).id;

    const embeddings = await embedTexts(doc.pages);

    const chunkRows = doc.pages.map((text, i) => ({
      document_id: documentId,
      index: i,
      text,
      token_count: Math.ceil(text.length / 4),
      embedding_model: EMBEDDING_MODEL,
      page_number: i + 1,
      char_start: 0,
      char_end: text.length,
      embedding: embeddings[i],
    }));

    const { data: inserted, error: chunkErr } = await admin
      .from('chunks')
      .insert(chunkRows)
      .select('id, index');
    if (chunkErr) throw new Error(`insert chunks for ${doc.id} failed: ${chunkErr.message}`);

    const byIndex = new Map<number, string>();
    for (const row of inserted as Array<{ id: string; index: number }>) {
      byIndex.set(row.index, row.id);
    }

    const slugMap: Record<string, string> = {};
    doc.chunkSlugs.forEach((slug, i) => {
      const chunkId = byIndex.get(i);
      if (!chunkId) throw new Error(`missing chunk index ${i} for ${doc.id}`);
      slugMap[slug] = chunkId;
    });
    documentMap[doc.id] = slugMap;

    console.log(`seeded ${doc.id} -> document ${documentId} (${doc.pages.length} chunks)`);
  }

  // 5. Emit the document map and surface the workspace id.
  await writeFile(mapPath, JSON.stringify(documentMap, null, 2), 'utf8');

  console.log('');
  console.log('seed complete. Export these for the live eval run:');
  console.log(`  EVAL_WORKSPACE_ID=${workspaceId}`);
  console.log(`  EVAL_DOCUMENT_MAP=${mapPath}`);
  console.log(`  (workspace owner: ${ownerEmail})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
