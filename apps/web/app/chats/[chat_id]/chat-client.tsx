'use client';
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react';
import type { components } from '@document-chat/contracts';
import { useChatStream } from '../../../lib/chat/use-chat-stream';
import { CitationChip } from './citation-chip';
import { CitationDrawer } from './citation-drawer';

type Message = components['schemas']['Message'];

export interface ChatClientProps {
  chatId: string;
  initialMessages: Message[];
  autoSendContent: string | null;
}

/**
 * Owns the live transcript + composer for a single chat. Renders any
 * server-loaded history first, then layers on the in-flight streaming
 * response (if any). After `message_completed`, the streaming response is
 * appended to the persisted history and the composer resets.
 */
export function ChatClient({ chatId, initialMessages, autoSendContent }: ChatClientProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [drawerChunkId, setDrawerChunkId] = useState<string | null>(null);
  const stream = useChatStream();
  const autoStartedRef = useRef(false);

  // Once a stream completes, snap the persisted assistant message onto the
  // history list and clear the live buffer.
  useEffect(() => {
    if (stream.status === 'completed' && stream.fullMessage) {
      setMessages((m) => [...m, stream.fullMessage as Message]);
    }
  }, [stream.status, stream.fullMessage]);

  // Auto-stream the assistant turn for the URL `?q=…` from the new-chat flow.
  // We optimistically render the user message immediately so the page doesn't
  // look empty while the first token arrives.
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (!autoSendContent) return;
    autoStartedRef.current = true;
    setMessages((m) => [
      ...m,
      {
        id: `pending-${Date.now()}`,
        chat_id: chatId,
        role: 'user',
        content: autoSendContent,
        citations: [],
        created_at: new Date().toISOString(),
      } as Message,
    ]);
    void stream.start({
      url: `/api/chats/${chatId}/messages`,
      body: { content: autoSendContent },
    });
    // Drop the `?q=…` from the URL (without a remount) so a refresh doesn't
    // re-send the same first message and create a duplicate turn.
    window.history.replaceState(null, '', `/chats/${chatId}`);
    // We intentionally exclude `stream` from deps: `start` is stable across
    // renders, and `stream` itself updates on every event which would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSendContent, chatId]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || stream.status === 'streaming') return;
    setMessages((m) => [
      ...m,
      {
        id: `pending-${Date.now()}`,
        chat_id: chatId,
        role: 'user',
        content: trimmed,
        citations: [],
        created_at: new Date().toISOString(),
      } as Message,
    ]);
    setDraft('');
    await stream.start({
      url: `/api/chats/${chatId}/messages`,
      body: { content: trimmed },
    });
  }

  // Only show the live streaming bubble while streaming. Once completed, the
  // persisted assistant message is appended to `messages` above — keeping the
  // streaming bubble visible on 'completed' rendered the answer twice.
  const showStreaming = stream.status === 'streaming';

  return (
    <div data-testid="chat-client" className="chat-layout">
      <ol className="transcript">
        {messages.map((message) => (
          <li key={message.id} className="message" data-role={message.role}>
            <div className="message__bubble">
              <span className="message__role">{message.role}</span>
              <MessageBody message={message} onCite={setDrawerChunkId} />
            </div>
          </li>
        ))}
        {showStreaming ? (
          <li className="message" data-role="assistant" data-testid="streaming-message">
            <div className="message__bubble">
              <span className="message__role">assistant</span>
              <span
                data-testid="streaming-content"
                className={stream.status === 'streaming' ? 'streaming-cursor' : undefined}
              >
                {stream.content || '…'}
              </span>
              {stream.citations.length > 0 ? (
                <span data-testid="streaming-citations">
                  {' '}
                  {stream.citations.map((citation, i) => (
                    <CitationChip
                      key={citation.id}
                      label={String(i + 1)}
                      onClick={() => setDrawerChunkId(citation.chunk_id)}
                    />
                  ))}
                </span>
              ) : null}
            </div>
          </li>
        ) : null}
        {stream.status === 'error' && stream.error ? (
          <li className="message" data-role="error">
            <div className="message__bubble">
              <span className="message__role">error</span>
              {stream.error.detail ?? stream.error.title}
            </div>
          </li>
        ) : null}
      </ol>

      <form onSubmit={onSubmit} className="composer" aria-label="Send a message">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Ask a follow-up…"
          required
          aria-label="Send a message"
        />
        <div className="composer__row">
          <button
            type="submit"
            className="btn"
            disabled={stream.status === 'streaming' || draft.trim().length === 0}
          >
            {stream.status === 'streaming' ? 'Streaming…' : 'Send'}
          </button>
        </div>
      </form>

      {drawerChunkId ? (
        <CitationDrawer chunkId={drawerChunkId} onClose={() => setDrawerChunkId(null)} />
      ) : null}
    </div>
  );
}

/**
 * Render a message body. Persisted assistant messages may carry inline
 * `[<chunk-uuid>]` markers — replace each with a CitationChip the user can
 * click to open the source drawer.
 */
function MessageBody({
  message,
  onCite,
}: {
  message: Message;
  onCite: (chunkId: string) => void;
}) {
  if (message.role !== 'assistant') return <span>{message.content}</span>;

  // chunk_id appears 1-based in the chip label for readability; we look up the
  // index from the message's citations list.
  const indexByChunkId = new Map(message.citations.map((c, i) => [c.chunk_id, i + 1] as const));

  const parts: Array<string | { chunkId: string; label: string }> = [];
  const re = /\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(message.content)) !== null) {
    if (match.index > lastIndex) parts.push(message.content.slice(lastIndex, match.index));
    const chunkId = match[1]!.toLowerCase();
    const label = String(indexByChunkId.get(chunkId) ?? '?');
    parts.push({ chunkId, label });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < message.content.length) parts.push(message.content.slice(lastIndex));

  return (
    <span>
      {parts.map((part, i) =>
        typeof part === 'string' ? (
          <span key={i}>{part}</span>
        ) : (
          <CitationChip key={i} label={part.label} onClick={() => onCite(part.chunkId)} />
        ),
      )}
    </span>
  );
}
