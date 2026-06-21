'use client';
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { components } from '@document-chat/contracts';
import { useChatStream } from '../../../lib/chat/use-chat-stream';
import { CitationChip } from './citation-chip';
import { CitationDrawer } from './citation-drawer';

type Message = components['schemas']['Message'];
type Citation = components['schemas']['Citation'];

/** Matches `[<uuid>]` citation markers in assistant content. */
const CITATION_MARKER_RE =
  /\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;

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
              <div
                data-testid="streaming-content"
                className={stream.status === 'streaming' ? 'streaming-cursor' : undefined}
              >
                {stream.content ? (
                  <AssistantMarkdown
                    content={stream.content}
                    citations={stream.citations}
                    onCite={setDrawerChunkId}
                  />
                ) : (
                  '…'
                )}
              </div>
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
 * Render assistant content as markdown, with inline `[<chunk-uuid>]` markers
 * turned into clickable CitationChips. We rewrite each marker to a markdown
 * link `[<n>](citation:<uuid>)` before parsing, then override the link renderer
 * to emit a chip for `citation:` hrefs — so markdown formatting and citations
 * both render without one breaking the other. (react-markdown ignores raw HTML
 * by default, so this is XSS-safe.)
 */
function AssistantMarkdown({
  content,
  citations,
  onCite,
}: {
  content: string;
  citations: Citation[];
  onCite: (chunkId: string) => void;
}) {
  // 1-based chip labels, looked up by chunk_id.
  const labelByChunkId = new Map(
    citations.map((c, i) => [c.chunk_id.toLowerCase(), String(i + 1)] as const),
  );
  const linkified = content.replace(CITATION_MARKER_RE, (_marker, idRaw: string) => {
    const id = idRaw.toLowerCase();
    const label = labelByChunkId.get(id);
    return label ? `[${label}](citation:${id})` : '';
  });

  return (
    <div className="message__markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Keep our internal `citation:` links (the default transform would strip
        // the unknown scheme); still sanitize every other URL.
        urlTransform={(url) => (url.startsWith('citation:') ? url : defaultUrlTransform(url))}
        components={{
          a({ href, children }) {
            if (href && href.startsWith('citation:')) {
              const chunkId = href.slice('citation:'.length);
              const label = String(Array.isArray(children) ? children.join('') : (children ?? ''));
              return <CitationChip label={label} onClick={() => onCite(chunkId)} />;
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {linkified}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Render a message body. User messages are plain text; assistant messages go
 * through {@link AssistantMarkdown} (markdown + citation chips).
 */
function MessageBody({
  message,
  onCite,
}: {
  message: Message;
  onCite: (chunkId: string) => void;
}) {
  if (message.role !== 'assistant') return <span>{message.content}</span>;
  return <AssistantMarkdown content={message.content} citations={message.citations} onCite={onCite} />;
}
