// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { components } from '@document-chat/contracts';

// Stub the citation UI (CitationDrawer fetches) and the streaming hook so we can
// drive the transcript rendering deterministically.
vi.mock('./citation-chip', () => ({
  CitationChip: ({ label }: { label: string }) => <button>{label}</button>,
}));
vi.mock('./citation-drawer', () => ({ CitationDrawer: () => null }));
vi.mock('../../../lib/chat/use-chat-stream', () => ({ useChatStream: vi.fn() }));

import { useChatStream } from '../../../lib/chat/use-chat-stream';
import { ChatClient } from './chat-client';

type Message = components['schemas']['Message'];
type Stream = ReturnType<typeof useChatStream>;

const assistantMsg = {
  id: 'a1',
  chat_id: 'c1',
  role: 'assistant',
  content: 'The answer.',
  citations: [],
  created_at: 'now',
} as Message;

function streamState(overrides: Partial<Stream>): Stream {
  return {
    status: 'idle',
    messageId: null,
    content: '',
    citations: [],
    fullMessage: null,
    error: null,
    start: vi.fn(),
    ...overrides,
  } as Stream;
}

beforeEach(() => vi.mocked(useChatStream).mockReset());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ChatClient', () => {
  it('renders a completed assistant message exactly once (no lingering streaming bubble)', () => {
    // Regression: showStreaming previously included 'completed', so the live
    // bubble stayed visible while the persisted message was also appended → the
    // answer rendered twice.
    vi.mocked(useChatStream).mockReturnValue(
      streamState({ status: 'completed', content: 'The answer.', fullMessage: assistantMsg }),
    );
    const { container } = render(
      <ChatClient chatId="c1" initialMessages={[]} autoSendContent={null} />,
    );
    expect(container.querySelectorAll('li[data-role="assistant"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="streaming-message"]')).toBeNull();
  });

  it('shows the streaming bubble only while streaming', () => {
    vi.mocked(useChatStream).mockReturnValue(streamState({ status: 'streaming', content: 'partial' }));
    const { container } = render(
      <ChatClient chatId="c1" initialMessages={[]} autoSendContent={null} />,
    );
    expect(container.querySelector('[data-testid="streaming-message"]')).not.toBeNull();
  });

  it('auto-send renders exactly one user message and starts the stream once', () => {
    // Regression: with the new-chat fix, initialMessages is empty, so the single
    // optimistic user message must be the only one (no duplicate).
    const start = vi.fn();
    vi.mocked(useChatStream).mockReturnValue(streamState({ status: 'streaming', start }));
    const { container } = render(
      <ChatClient chatId="c1" initialMessages={[]} autoSendContent="Who is Tom?" />,
    );
    expect(container.querySelectorAll('li[data-role="user"]')).toHaveLength(1);
    expect(start).toHaveBeenCalledTimes(1);
  });
});
