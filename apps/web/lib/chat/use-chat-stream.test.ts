// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import {
  applyEvent,
  parseSseFrames,
  type ChatStreamState,
} from './use-chat-stream';
import type { ChatEvent } from './sse';

const MSG_ID = '11111111-1111-1111-1111-111111111111';
const CHAT_ID = '22222222-2222-2222-2222-222222222222';
const CHUNK_ID = '33333333-3333-3333-3333-333333333333';

const INITIAL: ChatStreamState = {
  status: 'streaming',
  messageId: null,
  content: '',
  citations: [],
  fullMessage: null,
  error: null,
};

function reducer(events: ChatEvent[]): ChatStreamState {
  let state: ChatStreamState = INITIAL;
  for (const event of events) {
    applyEvent(event, (updater) => {
      state = updater(state);
    });
  }
  return state;
}

describe('applyEvent', () => {
  it('captures the message id from stream_start', () => {
    const state = reducer([
      {
        event: 'stream_start',
        data: { message_id: MSG_ID, chat_id: CHAT_ID, model: 'm', started_at: 'now' },
      },
    ]);
    expect(state.messageId).toBe(MSG_ID);
    expect(state.status).toBe('streaming');
  });

  it('appends each token delta to content in order', () => {
    const state = reducer([
      { event: 'token', data: { message_id: MSG_ID, delta: 'Hello, ', index: 0 } },
      { event: 'token', data: { message_id: MSG_ID, delta: 'world.', index: 1 } },
    ]);
    expect(state.content).toBe('Hello, world.');
  });

  it('accumulates citations in arrival order', () => {
    const citation = {
      id: 'cit-1',
      chunk_id: CHUNK_ID,
      document_id: 'doc',
      document_title: 'T',
      document_version: '1.0',
      page_number: 1,
      excerpt: 'x',
      unavailable: false,
      unavailable_reason: null,
    };
    const state = reducer([
      { event: 'citation', data: { message_id: MSG_ID, citation } },
    ]);
    expect(state.citations).toHaveLength(1);
    expect(state.citations[0]?.chunk_id).toBe(CHUNK_ID);
  });

  it('transitions to completed and replaces content with the persisted message', () => {
    const state = reducer([
      { event: 'token', data: { message_id: MSG_ID, delta: 'streamed-then-cleaned', index: 0 } },
      {
        event: 'message_completed',
        data: {
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
        },
      },
    ]);
    expect(state.status).toBe('completed');
    // Content snaps to the persisted message — invalid markers are already
    // stripped server-side, so the displayed text matches what's in the DB.
    expect(state.content).toBe('persisted');
    expect(state.fullMessage?.id).toBe(MSG_ID);
  });

  it('transitions to error and stores the problem', () => {
    const state = reducer([
      {
        event: 'error',
        data: {
          message_id: MSG_ID,
          problem: {
            type: 'about:blank',
            title: 'oops',
            status: 500,
            code: 'chat.stream_failed',
            request_id: 'req-1',
          },
        },
      },
    ]);
    expect(state.status).toBe('error');
    expect(state.error?.code).toBe('chat.stream_failed');
  });
});

async function readAll(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function bodyOf(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

describe('parseSseFrames', () => {
  it('parses well-formed frames', async () => {
    const body = bodyOf(
      `event: stream_start\nid: 0\ndata: ${JSON.stringify({
        message_id: MSG_ID,
        chat_id: CHAT_ID,
        model: 'm',
        started_at: 'now',
      })}\n\n` +
        `event: token\nid: 1\ndata: ${JSON.stringify({ message_id: MSG_ID, delta: 'hi', index: 0 })}\n\n`,
    );
    const events = await readAll(parseSseFrames(body));
    expect(events.map((e) => e.event)).toEqual(['stream_start', 'token']);
  });

  it('handles frames split across chunks of the underlying stream', async () => {
    const text =
      `event: token\nid: 0\ndata: ${JSON.stringify({ message_id: MSG_ID, delta: 'a', index: 0 })}\n\n` +
      `event: token\nid: 1\ndata: ${JSON.stringify({ message_id: MSG_ID, delta: 'b', index: 1 })}\n\n`;
    const encoder = new TextEncoder();
    const half = Math.floor(text.length / 2);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(text.slice(0, half)));
        controller.enqueue(encoder.encode(text.slice(half)));
        controller.close();
      },
    });
    const events = await readAll(parseSseFrames(body));
    expect(events).toHaveLength(2);
  });

  it('ignores frames with malformed JSON', async () => {
    const body = bodyOf('event: token\ndata: {not json\n\n');
    const events = await readAll(parseSseFrames(body));
    expect(events).toEqual([]);
  });

  it('ignores frames missing the event line', async () => {
    const body = bodyOf('data: {"x":1}\n\n');
    const events = await readAll(parseSseFrames(body));
    expect(events).toEqual([]);
  });
});
