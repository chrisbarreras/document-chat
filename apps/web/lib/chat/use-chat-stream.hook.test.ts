// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatStream } from './use-chat-stream';

const MSG_ID = '11111111-1111-1111-1111-111111111111';
const CHAT_ID = '22222222-2222-2222-2222-222222222222';

function sseBody(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

// Minimal Response stand-in — the hook only reads ok/status/body/json.
function fakeResponse(init: {
  ok: boolean;
  status: number;
  body?: ReadableStream<Uint8Array> | null;
  json?: () => Promise<unknown>;
}): Response {
  return {
    ok: init.ok,
    status: init.status,
    body: init.body ?? null,
    json: init.json ?? (async () => ({})),
  } as unknown as Response;
}

async function run(fetchImpl: typeof fetch) {
  const { result } = renderHook(() => useChatStream());
  await act(async () => {
    await result.current.start({ url: '/api/chats', body: { prompt: 'hi' }, fetchImpl });
  });
  return result;
}

describe('useChatStream', () => {
  it('consumes a stream to completion and snaps content to the persisted message', async () => {
    const text =
      `event: stream_start\ndata: ${JSON.stringify({ message_id: MSG_ID, chat_id: CHAT_ID, model: 'm', started_at: 'now' })}\n\n` +
      `event: token\ndata: ${JSON.stringify({ message_id: MSG_ID, delta: 'streamed', index: 0 })}\n\n` +
      `event: message_completed\ndata: ${JSON.stringify({
        message_id: MSG_ID,
        finish_reason: 'stop',
        full_message: {
          id: MSG_ID,
          chat_id: CHAT_ID,
          role: 'assistant',
          content: 'persisted',
          citations: [],
          created_at: 'now',
        },
      })}\n\n`;
    const fetchImpl = vi.fn(async () => fakeResponse({ ok: true, status: 200, body: sseBody(text) }));

    const result = await run(fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.current.status).toBe('completed');
    expect(result.current.messageId).toBe(MSG_ID);
    expect(result.current.content).toBe('persisted');
  });

  it('surfaces a Problem from a non-ok JSON response', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Too many requests',
      status: 429,
      code: 'rate.limited',
      request_id: 'req-9',
    };
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ ok: false, status: 429, json: async () => problem }),
    );

    const result = await run(fetchImpl as unknown as typeof fetch);

    expect(result.current.status).toBe('error');
    expect(result.current.error?.code).toBe('rate.limited');
  });

  it('falls back to a client Problem when the error body is not JSON', async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({
        ok: false,
        status: 503,
        json: async () => {
          throw new Error('not json');
        },
      }),
    );

    const result = await run(fetchImpl as unknown as typeof fetch);

    expect(result.current.status).toBe('error');
    expect(result.current.error?.code).toBe('client.stream_failed');
    expect(result.current.error?.detail).toBe('HTTP 503');
  });

  it('reports a client Problem when the fetch itself rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });

    const result = await run(fetchImpl as unknown as typeof fetch);

    expect(result.current.status).toBe('error');
    expect(result.current.error?.code).toBe('client.stream_failed');
    expect(result.current.error?.detail).toBe('network down');
  });

  it('reports an error when the stream breaks mid-flight', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('stream interrupted'));
      },
    });
    const fetchImpl = vi.fn(async () => fakeResponse({ ok: true, status: 200, body }));

    const result = await run(fetchImpl as unknown as typeof fetch);

    expect(result.current.status).toBe('error');
    expect(result.current.error?.code).toBe('client.stream_failed');
  });
});
