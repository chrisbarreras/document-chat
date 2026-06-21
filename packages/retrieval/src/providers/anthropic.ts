// SPDX-License-Identifier: Apache-2.0
//
// Anthropic streaming provider. Hand-rolled SSE parser over the
// `POST /v1/messages` endpoint so we don't pull the official SDK as a
// runtime dep — Anthropic's stream protocol is small enough and the SDK
// would force a duplicate `fetch` polyfill choice across Node 20 + edge.
//
// Yields a normalized event stream the chat orchestrator can map to the
// project's own `chat-events.schema.json` shape without leaking Anthropic
// payload details upward.

/** Default model. architecture.md picks Claude as the primary chat LLM. */
export const DEFAULT_CHAT_MODEL = 'claude-opus-4-7';

/**
 * Max output tokens for a single chat turn. Replies stream, so a generous cap
 * carries no HTTP-timeout risk — 1024 truncated longer multi-document answers
 * mid-sentence. Override per-deployment with `CHAT_MAX_TOKENS`.
 */
export const DEFAULT_MAX_TOKENS = 4096;

/** Normalized stream event. The chat route handler maps each to an SSE frame. */
export type AnthropicStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'usage'; input_tokens: number; output_tokens: number }
  | { type: 'stop'; finish_reason: 'stop' | 'length' | 'content_filter' | 'error' }
  | { type: 'error'; message: string };

export interface AnthropicChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnthropicStreamOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Inject a fetch (e.g. test stub). Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** API key override. Defaults to `process.env.ANTHROPIC_API_KEY`. */
  apiKey?: string;
  /** AbortSignal for client disconnects. */
  signal?: AbortSignal;
}

interface AnthropicMessageDelta {
  type: 'message_delta';
  delta: { stop_reason?: string | null };
  usage?: { output_tokens?: number };
}

interface AnthropicContentBlockDelta {
  type: 'content_block_delta';
  delta: { type: string; text?: string };
}

interface AnthropicMessageStart {
  type: 'message_start';
  message: { usage?: { input_tokens?: number; output_tokens?: number } };
}

interface AnthropicErrorFrame {
  type: 'error';
  error?: { message?: string };
}

function mapStopReason(reason: string | null | undefined): 'stop' | 'length' | 'content_filter' | 'error' {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'refusal':
      return 'content_filter';
    default:
      return 'stop';
  }
}

/**
 * Stream a chat completion from Anthropic. Emits normalized events in this
 * order:
 *   1. zero or more `text_delta`
 *   2. exactly one `usage` (input + final output tokens)
 *   3. exactly one `stop` (with mapped finish_reason)
 *
 * Throws on non-2xx response or empty body. The route handler decides
 * whether to translate that into an SSE `error` event or a JSON 5xx.
 */
export async function* streamAnthropicChat(
  system: string,
  messages: AnthropicChatMessage[],
  options: AnthropicStreamOptions = {},
): AsyncGenerator<AnthropicStreamEvent, void, undefined> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required to stream chat replies');
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const model = options.model ?? DEFAULT_CHAT_MODEL;
  const envMax = Number(process.env.CHAT_MAX_TOKENS);
  const maxTokens =
    options.maxTokens ?? (Number.isInteger(envMax) && envMax > 0 ? envMax : DEFAULT_MAX_TOKENS);

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    system,
    messages,
    stream: true,
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;

  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!res.ok || !res.body) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const errBody = (await res.json()) as { error?: { message?: string } };
      if (errBody.error?.message) detail = errBody.error.message;
    } catch {
      /* fall through */
    }
    throw new Error(`anthropic stream failed: ${detail}`);
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason: 'stop' | 'length' | 'content_filter' | 'error' = 'stop';
  let saw_message_start = false;
  let saw_message_delta = false;
  let saw_error = false;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by blank lines. Process completed frames; the
      // last partial frame stays in `buffer`.
      let frameEnd = buffer.indexOf('\n\n');
      while (frameEnd !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        frameEnd = buffer.indexOf('\n\n');

        // A frame is a list of `field: value` lines. We only need `data:`.
        const dataLine = frame
          .split('\n')
          .find((line) => line.startsWith('data:'));
        if (!dataLine) continue;
        const payload = dataLine.slice('data:'.length).trim();
        if (!payload || payload === '[DONE]') continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(payload) as Record<string, unknown>;
        } catch {
          continue;
        }

        switch (event.type) {
          case 'message_start': {
            const start = event as unknown as AnthropicMessageStart;
            if (start.message.usage?.input_tokens) {
              inputTokens = start.message.usage.input_tokens;
            }
            saw_message_start = true;
            break;
          }
          case 'content_block_delta': {
            const delta = event as unknown as AnthropicContentBlockDelta;
            if (delta.delta.type === 'text_delta' && typeof delta.delta.text === 'string') {
              yield { type: 'text_delta', text: delta.delta.text };
            }
            break;
          }
          case 'message_delta': {
            const md = event as unknown as AnthropicMessageDelta;
            if (md.delta.stop_reason) finishReason = mapStopReason(md.delta.stop_reason);
            if (md.usage?.output_tokens !== undefined) outputTokens = md.usage.output_tokens;
            saw_message_delta = true;
            break;
          }
          case 'message_stop':
            // Terminal frame; the post-loop emit handles usage + stop.
            break;
          case 'error': {
            const err = event as unknown as AnthropicErrorFrame;
            saw_error = true;
            yield { type: 'error', message: err.error?.message ?? 'unknown error' };
            break;
          }
          default:
            // Ignore content_block_start / content_block_stop / ping.
            break;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (saw_error) return;
  if (!saw_message_start && !saw_message_delta) {
    throw new Error('anthropic stream ended before any content');
  }

  yield {
    type: 'usage',
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  };
  yield { type: 'stop', finish_reason: finishReason };
}
