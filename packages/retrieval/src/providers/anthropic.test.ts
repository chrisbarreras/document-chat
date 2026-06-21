// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi } from 'vitest';
import {
  streamAnthropicChat,
  type AnthropicStreamEvent,
} from './anthropic';

function sseBody(frames: string[]): Response {
  const body = frames.join('\n\n') + '\n\n';
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function collect(stream: AsyncIterable<AnthropicStreamEvent>): Promise<AnthropicStreamEvent[]> {
  const out: AnthropicStreamEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

const happyFrames = [
  'event: message_start\ndata: ' +
    JSON.stringify({
      type: 'message_start',
      message: { usage: { input_tokens: 12 } },
    }),
  'event: content_block_delta\ndata: ' +
    JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'Hello, ' },
    }),
  'event: content_block_delta\ndata: ' +
    JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'world.' },
    }),
  'event: message_delta\ndata: ' +
    JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 30 },
    }),
  'event: message_stop\ndata: ' + JSON.stringify({ type: 'message_stop' }),
];

describe('streamAnthropicChat', () => {
  it('yields text deltas, then a final usage and stop', async () => {
    const fetchImpl = vi.fn(async () => sseBody(happyFrames));
    const events = await collect(
      streamAnthropicChat('system', [{ role: 'user', content: 'hi' }], {
        apiKey: 'sk',
        fetch: fetchImpl as unknown as typeof fetch,
      }),
    );
    const types = events.map((e) => e.type);
    expect(types).toEqual(['text_delta', 'text_delta', 'usage', 'stop']);
    expect((events[0] as Extract<AnthropicStreamEvent, { type: 'text_delta' }>).text).toBe('Hello, ');
    expect((events[2] as Extract<AnthropicStreamEvent, { type: 'usage' }>).input_tokens).toBe(12);
    expect((events[2] as Extract<AnthropicStreamEvent, { type: 'usage' }>).output_tokens).toBe(30);
    expect((events[3] as Extract<AnthropicStreamEvent, { type: 'stop' }>).finish_reason).toBe('stop');
  });

  it('defaults max_tokens to 4096 and honors options.maxTokens + CHAT_MAX_TOKENS', async () => {
    let captured: { max_tokens?: number } = {};
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      captured = JSON.parse(init!.body as string);
      return sseBody(happyFrames);
    });
    const run = (opts: Record<string, unknown>) =>
      collect(
        streamAnthropicChat('s', [{ role: 'user', content: 'hi' }], {
          apiKey: 'sk',
          fetch: fetchImpl as unknown as typeof fetch,
          ...opts,
        }),
      );

    await run({});
    expect(captured.max_tokens).toBe(4096); // generous default (streamed, no timeout risk)

    await run({ maxTokens: 512 });
    expect(captured.max_tokens).toBe(512); // explicit option wins

    const prev = process.env.CHAT_MAX_TOKENS;
    process.env.CHAT_MAX_TOKENS = '8000';
    try {
      await run({});
      expect(captured.max_tokens).toBe(8000); // env override
    } finally {
      if (prev === undefined) delete process.env.CHAT_MAX_TOKENS;
      else process.env.CHAT_MAX_TOKENS = prev;
    }
  });

  it('maps max_tokens stop_reason to finish_reason length', async () => {
    const frames = [
      ...happyFrames.slice(0, 3),
      'event: message_delta\ndata: ' +
        JSON.stringify({
          type: 'message_delta',
          delta: { stop_reason: 'max_tokens' },
          usage: { output_tokens: 30 },
        }),
    ];
    const fetchImpl = vi.fn(async () => sseBody(frames));
    const events = await collect(
      streamAnthropicChat('system', [{ role: 'user', content: 'hi' }], {
        apiKey: 'sk',
        fetch: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect((events[events.length - 1] as Extract<AnthropicStreamEvent, { type: 'stop' }>).finish_reason).toBe(
      'length',
    );
  });

  it('handles SSE frames split across reader chunks', async () => {
    // Simulate the chunked fetch body by hand-crafting a stream that yields
    // bytes in the middle of a frame's JSON.
    const fullBody = happyFrames.join('\n\n') + '\n\n';
    const encoder = new TextEncoder();
    const half = Math.floor(fullBody.length / 2);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(fullBody.slice(0, half)));
        controller.enqueue(encoder.encode(fullBody.slice(half)));
        controller.close();
      },
    });
    const res = new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    const fetchImpl = vi.fn(async () => res);
    const events = await collect(
      streamAnthropicChat('system', [{ role: 'user', content: 'hi' }], {
        apiKey: 'sk',
        fetch: fetchImpl as unknown as typeof fetch,
      }),
    );
    const types = events.map((e) => e.type);
    expect(types).toEqual(['text_delta', 'text_delta', 'usage', 'stop']);
  });

  it('throws on a non-2xx response with the Anthropic error message', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 }),
    );
    await expect(
      collect(
        streamAnthropicChat('system', [{ role: 'user', content: 'hi' }], {
          apiKey: 'sk',
          fetch: fetchImpl as unknown as typeof fetch,
        }),
      ),
    ).rejects.toThrow(/rate limited/);
  });

  it('yields an error event and stops when the stream emits an error frame', async () => {
    const frames = [
      'event: error\ndata: ' +
        JSON.stringify({ type: 'error', error: { message: 'oops' } }),
    ];
    const fetchImpl = vi.fn(async () => sseBody(frames));
    const events = await collect(
      streamAnthropicChat('system', [{ role: 'user', content: 'hi' }], {
        apiKey: 'sk',
        fetch: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('error');
  });

  it('throws when neither apiKey nor ANTHROPIC_API_KEY is set', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(
        collect(streamAnthropicChat('system', [{ role: 'user', content: 'hi' }])),
      ).rejects.toThrow(/ANTHROPIC_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});
