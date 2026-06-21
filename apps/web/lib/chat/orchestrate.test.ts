// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi } from 'vitest';
import type { components } from '@document-chat/contracts';
import type {
  AnthropicStreamEvent,
  SearchResultRow,
} from '@document-chat/retrieval';
import {
  buildSystemPrompt,
  runChatTurn,
  type OrchestratorDeps,
  type PersistAssistantInput,
} from './orchestrate';
import type { ChatEvent } from './sse';

type Message = components['schemas']['Message'];

const CHAT_ID = '44444444-4444-4444-4444-444444444444';
const MSG_ID = '55555555-5555-5555-5555-555555555555';
const CHUNK_A = '11111111-1111-1111-1111-111111111111';
const CHUNK_B = '22222222-2222-2222-2222-222222222222';

function row(id: string, score: number): SearchResultRow {
  return {
    id,
    document_id: '99999999-9999-9999-9999-999999999999',
    document_title: 'Doc',
    document_version: '1.0',
    index: 0,
    text: `chunk text for ${id}`,
    token_count: 10,
    embedding_model: 'text-embedding-3-small',
    page_number: 1,
    char_start: 0,
    char_end: 5,
    section_path: null,
    score,
    created_at: '2026-06-08T00:00:00.000Z',
    updated_at: '2026-06-08T00:00:00.000Z',
  };
}

async function* yieldStream(events: AnthropicStreamEvent[]): AsyncGenerator<AnthropicStreamEvent> {
  for (const e of events) yield e;
}

function makeDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  const fakeMessage = (input: PersistAssistantInput): Message => ({
    id: input.messageId,
    chat_id: input.chatId,
    role: 'assistant',
    content: input.content,
    citations: [],
    created_at: '2026-06-08T00:00:00.000Z',
    model: input.model,
    finish_reason: input.finishReason,
    usage: {
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      total_tokens: input.inputTokens + input.outputTokens,
    },
  });
  return {
    retrieve: vi.fn().mockResolvedValue([row(CHUNK_A, 0.9), row(CHUNK_B, 0.7)]),
    stream: vi.fn().mockImplementation(() =>
      yieldStream([
        { type: 'text_delta', text: `Per [${CHUNK_A}], yes. ` },
        { type: 'text_delta', text: `Also [${CHUNK_B}].` },
        { type: 'usage', input_tokens: 12, output_tokens: 30 },
        { type: 'stop', finish_reason: 'stop' },
      ]),
    ),
    persistAssistant: vi.fn().mockImplementation(async (input: PersistAssistantInput) =>
      fakeMessage(input),
    ),
    newId: () => MSG_ID,
    now: () => '2026-06-08T00:00:00.000Z',
    ...overrides,
  };
}

async function collect(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('runChatTurn', () => {
  it('emits the schema-required event sequence in the correct order', async () => {
    const deps = makeDeps();
    const events = await collect(
      runChatTurn(deps, { chatId: CHAT_ID, userMessage: 'q', topK: 8, model: 'm' }),
    );
    const types = events.map((e) => e.event);
    expect(types[0]).toBe('stream_start');
    expect(types[1]).toBe('retrieval_started');
    expect(types[2]).toBe('retrieval_completed');
    // Citations come before any tokens.
    const firstToken = types.indexOf('token');
    const lastCitation = types.lastIndexOf('citation');
    expect(lastCitation).toBeLessThan(firstToken);
    // Usage and message_completed are the terminal two events.
    expect(types[types.length - 2]).toBe('usage');
    expect(types[types.length - 1]).toBe('message_completed');
  });

  it('emits exactly one citation event per retrieved chunk', async () => {
    const events = await collect(
      runChatTurn(makeDeps(), { chatId: CHAT_ID, userMessage: 'q', topK: 8, model: 'm' }),
    );
    const citations = events.filter((e) => e.event === 'citation');
    expect(citations).toHaveLength(2);
  });

  it('strips an invalid marker before persisting and records only valid citations', async () => {
    const deps = makeDeps({
      stream: vi.fn().mockImplementation(() =>
        yieldStream([
          { type: 'text_delta', text: `Per [${CHUNK_A}] and [33333333-3333-3333-3333-333333333333] bad.` },
          { type: 'usage', input_tokens: 8, output_tokens: 20 },
          { type: 'stop', finish_reason: 'stop' },
        ]),
      ),
    });
    await collect(
      runChatTurn(deps, { chatId: CHAT_ID, userMessage: 'q', topK: 8, model: 'm' }),
    );
    const persistCall = vi.mocked(deps.persistAssistant).mock.calls[0]![0];
    expect(persistCall.content).toBe(`Per [${CHUNK_A}] and  bad.`);
    expect(persistCall.citations).toHaveLength(1);
    expect(persistCall.citations[0]!.chunkId).toBe(CHUNK_A);
  });

  it('propagates an LLM stream error so the SSE serializer can emit error', async () => {
    const deps = makeDeps({
      stream: vi.fn().mockImplementation(() =>
        yieldStream([{ type: 'error', message: 'rate limited' }]),
      ),
    });
    await expect(
      collect(runChatTurn(deps, { chatId: CHAT_ID, userMessage: 'q', topK: 8, model: 'm' })),
    ).rejects.toThrow(/rate limited/);
  });

  it('passes the user message through to the LLM call and surfaces tokens in order', async () => {
    const deps = makeDeps();
    const events = await collect(
      runChatTurn(deps, { chatId: CHAT_ID, userMessage: 'what is X?', topK: 4, model: 'm' }),
    );
    const tokenIndices = events
      .filter((e) => e.event === 'token')
      .map((e) => (e as Extract<ChatEvent, { event: 'token' }>).data.index);
    expect(tokenIndices).toEqual([0, 1]);
    expect(deps.stream).toHaveBeenCalledWith(expect.any(String), [
      { role: 'user', content: 'what is X?' },
    ]);
  });

  it('prepends prior conversation history before the current user turn', async () => {
    const deps = makeDeps();
    const history = [
      { role: 'user' as const, content: 'first question' },
      { role: 'assistant' as const, content: 'first answer' },
    ];
    await collect(
      runChatTurn(deps, {
        chatId: CHAT_ID,
        userMessage: 'follow-up',
        topK: 4,
        model: 'm',
        history,
      }),
    );
    expect(deps.stream).toHaveBeenCalledWith(expect.any(String), [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'follow-up' },
    ]);
  });
});

describe('buildSystemPrompt', () => {
  it('includes every retrieved chunk with its chunk_id marker target', () => {
    const prompt = buildSystemPrompt([row(CHUNK_A, 0.9), row(CHUNK_B, 0.8)]);
    expect(prompt).toContain(`chunk_id=${CHUNK_A}`);
    expect(prompt).toContain(`chunk_id=${CHUNK_B}`);
    expect(prompt).toContain('[<chunk-id>]');
    expect(prompt).toContain('chunk text for');
  });
});
