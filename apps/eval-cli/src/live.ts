// SPDX-License-Identifier: Apache-2.0
//
// Live `ChatClient` for the nightly real-LLM eval run. Issues a single
// chat turn per golden question against the deployed API and reads the
// SSE stream into the runner's `ChatTurnOutput` shape.
//
// Scope contract (so the live runner stays small):
//
//   - Documents are *pre-ingested* into the workspace named by
//     EVAL_WORKSPACE_ID. The nightly job uploads `packages/eval/fixtures/`
//     once (as a separate workflow step) and waits for `ready` before
//     invoking this CLI. The mapping from corpus.json slug → real
//     chunk UUID is materialised into a JSON file (path passed via
//     EVAL_DOCUMENT_MAP) so the runner can translate symbolic
//     `expectedChunkIds` into the UUIDs the assistant will actually emit.
//
//   - A fresh chat is created per question (no follow-ups in Tier 1).
//
// The contract is intentionally simple — the heavy lifting (real OpenAI +
// Anthropic + Postgres) happens server-side, behind the deployed API.

import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import type { ChatClient, ChatTurnInput, ChatTurnOutput } from '@document-chat/eval';

export interface LiveOptions {
  apiBaseUrl: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
  workspaceId: string;
  /**
   * Path to a JSON file mapping symbolic corpus slugs to real chunk UUIDs:
   *   { "<documentId>": { "<slug>": "<chunk-uuid>", ... }, ... }
   * The seeder writes this file after upload completes.
   */
  documentMapPath: string;
}

interface DocumentMap {
  [documentId: string]: { [slug: string]: string };
}

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

/**
 * Build a live `ChatClient`. The returned function creates a chat, posts the
 * user question with `Accept: text/event-stream`, parses the SSE stream into
 * the union of citation events + cleaned content, and returns the
 * `ChatTurnOutput` the runner consumes. Errors surface as thrown exceptions
 * — the runner records the case as failed and continues.
 */
export async function liveClient(opts: LiveOptions): Promise<ChatClient> {
  const mapRaw = await readFile(opts.documentMapPath, 'utf8');
  const map = JSON.parse(mapRaw) as DocumentMap;

  // Mint a session token via the admin API so we can act as the workspace
  // owner without storing a long-lived JWT in CI secrets.
  const admin = createClient(opts.supabaseUrl, opts.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return async (input: ChatTurnInput): Promise<ChatTurnOutput> => {
    const docMap = map[input.documentId];
    if (!docMap) {
      throw new Error(`live runner: no document map entry for ${input.documentId}`);
    }

    // Look up the workspace owner once per call. The seeder records the
    // owner email under a known key; resolving the user id here keeps the
    // live client self-contained.
    const { data: workspace, error: wsError } = await admin
      .from('workspaces')
      .select('owner_id')
      .eq('id', opts.workspaceId)
      .single();
    if (wsError) throw new Error(`workspace lookup failed: ${wsError.message}`);
    const ownerId = (workspace as { owner_id: string }).owner_id;

    // Mint a real session for the workspace owner: generate a magic-link
    // token hash with the admin API, then exchange it for an access-token JWT
    // via verifyOtp. The JWT is what the API's Bearer auth validates (a raw
    // `hashed_token` is only a verification hash, not a usable access token).
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: `eval+${ownerId}@example.com`,
    });
    if (linkError) throw new Error(`link generation failed: ${linkError.message}`);
    const tokenHash = (link as { properties?: { hashed_token?: string } }).properties?.hashed_token;
    if (!tokenHash) throw new Error('link generation did not return a token hash');

    const { data: session, error: verifyError } = await admin.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'magiclink',
    });
    if (verifyError) throw new Error(`session mint failed: ${verifyError.message}`);
    const accessToken = session.session?.access_token;
    if (!accessToken) throw new Error('session mint did not return an access token');

    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    };

    const chatRes = await fetch(`${opts.apiBaseUrl}/api/chats`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workspace_id: opts.workspaceId, title: input.question.slice(0, 80) }),
    });
    if (!chatRes.ok) throw new Error(`create chat failed: ${chatRes.status}`);
    const chat = (await chatRes.json()) as { id: string };

    const msgRes = await fetch(`${opts.apiBaseUrl}/api/chats/${chat.id}/messages`, {
      method: 'POST',
      headers: { ...headers, accept: 'text/event-stream' },
      body: JSON.stringify({ content: input.question, top_k: input.topK }),
    });
    if (!msgRes.ok || !msgRes.body) throw new Error(`stream open failed: ${msgRes.status}`);

    return parseStream(msgRes.body, docMap);
  };
}

async function parseStream(
  body: ReadableStream<Uint8Array>,
  docMap: { [slug: string]: string },
): Promise<ChatTurnOutput> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: SseEvent[] = [];

  let done = false;
  while (!done) {
    const next = await reader.read();
    done = next.done;
    if (next.value) buffer += decoder.decode(next.value, { stream: true });
    let frameEnd = buffer.indexOf('\n\n');
    while (frameEnd !== -1) {
      const frame = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);
      frameEnd = buffer.indexOf('\n\n');
      const eventLine = frame.split('\n').find((l) => l.startsWith('event:'));
      const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!eventLine || !dataLine) continue;
      const event = eventLine.slice('event:'.length).trim();
      const data = JSON.parse(dataLine.slice('data:'.length).trim()) as Record<string, unknown>;
      events.push({ event, data });
    }
  }

  const retrievedChunkIds: string[] = [];
  const citedChunkIds: string[] = [];
  let answer = '';
  let fullMessage: { content?: string; citations?: Array<{ chunk_id: string }> } | undefined;

  for (const e of events) {
    switch (e.event) {
      case 'retrieval_completed':
        retrievedChunkIds.push(...((e.data.chunk_ids as string[]) ?? []));
        break;
      case 'token':
        answer += String(e.data.delta ?? '');
        break;
      case 'message_completed':
        fullMessage = e.data.full_message as typeof fullMessage;
        break;
    }
  }

  if (fullMessage?.content) answer = fullMessage.content;
  if (fullMessage?.citations) {
    for (const c of fullMessage.citations) citedChunkIds.push(c.chunk_id);
  }

  // Translate real UUIDs back to symbolic slugs so metric functions can
  // compare against `expectedChunkIds`. Anything unmapped (a UUID we didn't
  // upload) stays as a UUID — it'll fail precision, which is what we want.
  const reverse = new Map<string, string>();
  for (const [slug, uuid] of Object.entries(docMap)) reverse.set(uuid, slug);
  const remap = (id: string): string => reverse.get(id) ?? id;

  return {
    retrievedChunkIds: retrievedChunkIds.map(remap),
    citedChunkIds: citedChunkIds.map(remap),
    answer,
  };
}
