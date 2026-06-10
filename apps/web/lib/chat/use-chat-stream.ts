// SPDX-License-Identifier: Apache-2.0
'use client';

import { useCallback, useRef, useState } from 'react';
import type { components } from '@document-chat/contracts';
import type { ChatEvent } from './sse';

type Message = components['schemas']['Message'];
type Citation = components['schemas']['Citation'];
type Problem = components['schemas']['Problem'];

/**
 * State emitted by `useChatStream`. The hook accumulates token deltas into
 * `content`, captures the retrieval citation set, and records terminal
 * state (success or error) so the caller can render a transcript without
 * tracking events manually.
 */
export interface ChatStreamState {
  status: 'idle' | 'streaming' | 'completed' | 'error';
  messageId: string | null;
  content: string;
  citations: Citation[];
  fullMessage: Message | null;
  error: Problem | null;
}

const INITIAL_STATE: ChatStreamState = {
  status: 'idle',
  messageId: null,
  content: '',
  citations: [],
  fullMessage: null,
  error: null,
};

export interface StartOptions {
  /** URL to POST to (e.g. `/api/chats/{id}/messages` or `/api/chats`). */
  url: string;
  /** Request body. Wrapped in JSON.stringify by the hook. */
  body: unknown;
  /** Optional fetch override for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Drive a chat SSE stream from the client. Returns the live state + a
 * `start` callback. Each call cancels any in-flight stream and starts a
 * new one.
 *
 * The hook only knows about SSE frames — frame parsing lives in
 * `parseSseFrames` so the unit test can exercise it without React.
 */
export function useChatStream(): ChatStreamState & { start: (opts: StartOptions) => Promise<void> } {
  const [state, setState] = useState<ChatStreamState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async ({ url, body, fetchImpl }: StartOptions) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ ...INITIAL_STATE, status: 'streaming' });

    let res: Response;
    try {
      res = await (fetchImpl ?? fetch)(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      setState((s) => ({
        ...s,
        status: 'error',
        error: clientProblem(err instanceof Error ? err.message : 'Network error'),
      }));
      return;
    }

    if (!res.ok || !res.body) {
      let problem: Problem;
      try {
        problem = (await res.json()) as Problem;
      } catch {
        problem = clientProblem(`HTTP ${res.status}`);
      }
      setState((s) => ({ ...s, status: 'error', error: problem }));
      return;
    }

    try {
      for await (const event of parseSseFrames(res.body)) {
        applyEvent(event, setState);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setState((s) => ({
        ...s,
        status: 'error',
        error: clientProblem(err instanceof Error ? err.message : 'Stream interrupted'),
      }));
    }
  }, []);

  return { ...state, start };
}

/**
 * Apply one parsed SSE event to the state. Split out so the unit test can
 * drive it directly without spinning up React.
 */
export function applyEvent(
  event: ChatEvent,
  setState: (updater: (s: ChatStreamState) => ChatStreamState) => void,
): void {
  switch (event.event) {
    case 'stream_start':
      setState((s) => ({ ...s, messageId: event.data.message_id }));
      return;
    case 'citation':
      setState((s) => ({ ...s, citations: [...s.citations, event.data.citation] }));
      return;
    case 'token':
      setState((s) => ({ ...s, content: s.content + event.data.delta }));
      return;
    case 'message_completed':
      setState((s) => ({
        ...s,
        status: 'completed',
        fullMessage: event.data.full_message,
        // Prefer the persisted message's content (citations cleaned) over the
        // streamed token concatenation, which may still carry stripped markers.
        content: event.data.full_message.content,
      }));
      return;
    case 'error':
      setState((s) => ({ ...s, status: 'error', error: event.data.problem }));
      return;
    default:
      return;
  }
}

/**
 * Parse the SSE body byte stream into a sequence of `ChatEvent`s. Yields
 * each event as soon as a complete frame is buffered. Closes when the
 * underlying stream closes.
 */
export async function* parseSseFrames(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatEvent, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let frameEnd = buffer.indexOf('\n\n');
      while (frameEnd !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        frameEnd = buffer.indexOf('\n\n');
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(frame: string): ChatEvent | null {
  let eventName: string | null = null;
  let dataLine: string | null = null;
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) dataLine = line.slice('data:'.length).trim();
  }
  if (!eventName || dataLine === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(dataLine);
  } catch {
    return null;
  }
  return { event: eventName, data } as ChatEvent;
}

function clientProblem(detail: string): Problem {
  return {
    type: 'https://docs.knowledge-graph.dev/errors/client-stream-failed',
    title: 'Stream failed',
    status: 0,
    code: 'client.stream_failed',
    request_id: crypto.randomUUID(),
    detail,
  };
}
