// SPDX-License-Identifier: Apache-2.0
//
// Chat-turn orchestrator. Coordinates retrieval, the LLM stream, citation
// extraction, and DB persistence; emits chat events in the order the schema
// requires. Pure with respect to its deps so the unit test can drive every
// path without standing up Supabase or hitting Anthropic.
//
// Event order (Tier 1):
//   stream_start
//   retrieval_started
//   retrieval_completed
//   citation*           — one per retrieved chunk (so any marker in tokens
//                         is pre-declared; satisfies REQ-1.5.4)
//   token*              — text deltas as they arrive
//   usage               — exactly one
//   message_completed   — terminal, with the persisted Message
//
// On any thrown error the generator emits a terminal `error` event instead
// of `message_completed`; the SSE serializer takes care of the wire frame.

import type { components } from '@document-chat/contracts';
import type { SearchResultRow } from '@document-chat/retrieval';
import { extractCitations } from './citations';
import type { ChatEvent } from './sse';
import type { AnthropicStreamEvent } from '@document-chat/retrieval';

type Citation = components['schemas']['Citation'];
type Message = components['schemas']['Message'];

export interface OrchestratorDeps {
  /** Retrieve chunks for the user message. */
  retrieve: (query: string, topK: number) => Promise<SearchResultRow[]>;
  /** Stream LLM events from Claude. `system` already includes retrieval context. */
  stream: (
    system: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  ) => AsyncIterable<AnthropicStreamEvent>;
  /** Persist the assistant message + citations. Called after the stream completes. */
  persistAssistant: (input: PersistAssistantInput) => Promise<Message>;
  /** Build the message id up-front so it can appear in every event. */
  newId: () => string;
  /** ISO timestamp factory (`now()`); pluggable for tests. */
  now: () => string;
}

export interface PersistAssistantInput {
  /** Pre-allocated assistant message id (same one the events carry). */
  messageId: string;
  chatId: string;
  content: string;
  model: string;
  finishReason: 'stop' | 'length' | 'content_filter' | 'error';
  inputTokens: number;
  outputTokens: number;
  citations: Array<{ chunkId: string; documentId: string; score: number; index: number }>;
}

export interface OrchestrateOptions {
  chatId: string;
  userMessage: string;
  topK: number;
  model: string;
  /**
   * Prior conversation turns (oldest first), giving the model memory of the
   * chat so far. Must start with a `user` turn and alternate (the API tolerates
   * consecutive same-role turns by merging them). Citation markers should be
   * stripped before passing them here. Defaults to none (single-turn).
   */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/**
 * Convert a `SearchResultRow` to a contract `Citation`. The excerpt is the
 * chunk text verbatim at Tier 1 (a Tier 4 follow-up may shorten it).
 */
function rowToCitation(row: SearchResultRow): Citation {
  return {
    id: crypto.randomUUID(),
    chunk_id: row.id,
    document_id: row.document_id,
    document_title: row.document_title,
    document_version: row.document_version,
    page_number: row.page_number,
    excerpt: row.text,
    score: row.score,
    unavailable: false,
    unavailable_reason: null,
  };
}

/**
 * Build the system prompt. Inlines every retrieved chunk with its
 * `[<chunk-id>]` marker so the LLM has both the content and the canonical
 * citation token to reference.
 */
export function buildSystemPrompt(rows: SearchResultRow[]): string {
  const header = [
    'You are a precise document-chat assistant. Answer the user using ONLY the',
    'sources below. For every claim, cite the source by inserting the marker',
    '[<chunk-id>] immediately after the claim, using the chunk_id verbatim.',
    'Never fabricate a chunk_id. If the sources do not contain the answer, say so.',
  ].join(' ');
  const sources = rows
    .map(
      (row) =>
        `[chunk_id=${row.id}] document="${row.document_title}" v${row.document_version}` +
        (row.page_number !== null ? ` page=${row.page_number}` : '') +
        `\n${row.text}`,
    )
    .join('\n\n');
  return `${header}\n\nSources:\n${sources}`;
}

/**
 * Run a chat turn end-to-end. Yields events for the SSE serializer; persists
 * the assistant message + citations through `deps.persistAssistant` once the
 * stream finishes.
 */
export async function* runChatTurn(
  deps: OrchestratorDeps,
  options: OrchestrateOptions,
): AsyncGenerator<ChatEvent, void, undefined> {
  const messageId = deps.newId();
  const startedAt = deps.now();

  yield {
    event: 'stream_start',
    data: {
      message_id: messageId,
      chat_id: options.chatId,
      model: options.model,
      started_at: startedAt,
    },
  };

  yield {
    event: 'retrieval_started',
    data: { message_id: messageId, top_k: options.topK, mode: 'vector', as_of_date: null },
  };

  const retrieveStart = Date.now();
  let rows: SearchResultRow[];
  try {
    rows = await deps.retrieve(options.userMessage, options.topK);
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }
  const elapsedMs = Date.now() - retrieveStart;

  yield {
    event: 'retrieval_completed',
    data: {
      message_id: messageId,
      chunk_ids: rows.map((r) => r.id),
      elapsed_ms: elapsedMs,
    },
  };

  // Pre-declare every retrieved chunk as a citation so the post-stream
  // marker validation can accept any of them without a follow-up event.
  for (const row of rows) {
    yield { event: 'citation', data: { message_id: messageId, citation: rowToCitation(row) } };
  }

  // Stream the LLM reply. Prior turns (if any) give the model conversation
  // memory; the current user message is always the final turn.
  const system = buildSystemPrompt(rows);
  let content = '';
  let tokenIndex = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason: 'stop' | 'length' | 'content_filter' | 'error' = 'stop';

  for await (const event of deps.stream(system, [
    ...(options.history ?? []),
    { role: 'user', content: options.userMessage },
  ])) {
    switch (event.type) {
      case 'text_delta':
        content += event.text;
        yield {
          event: 'token',
          data: { message_id: messageId, delta: event.text, index: tokenIndex++ },
        };
        break;
      case 'usage':
        inputTokens = event.input_tokens;
        outputTokens = event.output_tokens;
        break;
      case 'stop':
        finishReason = event.finish_reason;
        break;
      case 'error':
        throw new Error(event.message);
    }
  }

  yield {
    event: 'usage',
    data: {
      message_id: messageId,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };

  // Post-process: strip markers that point at chunks we didn't retrieve,
  // and collect the ones the LLM actually used in order.
  const validIds = rows.map((r) => r.id);
  const { cleanedContent, citations } = extractCitations(content, validIds);
  const documentByChunk = new Map(rows.map((r) => [r.id, r] as const));

  const fullMessage = await deps.persistAssistant({
    messageId,
    chatId: options.chatId,
    content: cleanedContent,
    model: options.model,
    finishReason,
    inputTokens,
    outputTokens,
    citations: citations.map((c) => ({
      chunkId: c.chunkId,
      documentId: documentByChunk.get(c.chunkId)?.document_id ?? '',
      score: documentByChunk.get(c.chunkId)?.score ?? 0,
      index: c.index,
    })),
  });

  yield {
    event: 'message_completed',
    data: { message_id: messageId, finish_reason: finishReason, full_message: fullMessage },
  };
}
