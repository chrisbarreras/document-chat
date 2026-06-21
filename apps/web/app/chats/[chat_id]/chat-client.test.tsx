// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { components } from '@document-chat/contracts';

// Stub the citation UI (CitationDrawer fetches) and the streaming hook so we can
// drive the transcript rendering deterministically.
vi.mock('./citation-chip', () => ({
  CitationChip: ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button data-testid="citation-chip" onClick={onClick}>
      {label}
    </button>
  ),
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

  it('renders assistant markdown and turns citation markers into chips', () => {
    const chunkId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const md = {
      ...assistantMsg,
      content: `**Bold** then a list:\n\n- one\n- two\n\nPer the contract [${chunkId}].`,
      citations: [
        {
          id: 'cit1',
          chunk_id: chunkId,
          document_id: 'd1',
          document_title: 'Contract',
          document_version: '1',
          page_number: 1,
          excerpt: 'x',
          score: 0.9,
          unavailable: false,
          unavailable_reason: null,
        },
      ],
    } as Message;
    vi.mocked(useChatStream).mockReturnValue(streamState({ status: 'idle' }));
    const { container } = render(
      <ChatClient chatId="c1" initialMessages={[md]} autoSendContent={null} />,
    );
    // Markdown actually rendered to elements, not raw text.
    expect(container.querySelector('strong')?.textContent).toBe('Bold');
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    // The citation marker became a clickable chip labelled "1".
    const chip = container.querySelector('[data-testid="citation-chip"]');
    expect(chip?.textContent).toBe('1');
    // The raw uuid marker is gone from the visible text.
    expect(container.textContent).not.toContain(chunkId);
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
