'use client';
// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Small composer for starting a new chat. Creates the chat via the JSON POST
 * path so the new id is known immediately, then navigates to the chat page
 * with the first message as a query param — the chat page auto-starts the
 * SSE turn on mount. Keeps the streaming logic in one place
 * (apps/web/app/chats/[chat_id]/chat-client.tsx).
 */
export function NewChatComposer() {
  const router = useRouter();
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      // Create the chat with a title only — do NOT send first_message here.
      // The chat page auto-sends (and persists) the first message exactly once
      // via /messages; persisting it here too produced a duplicate user
      // message (one row from create + one from the auto-send). Title mirrors
      // the server's defaultChatTitle so it still reflects the question.
      const title = trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail ?? 'Could not create chat.');
      }
      const chat = (await res.json()) as { id: string };
      // Pass the first message via the URL so the chat page knows to stream
      // an assistant turn for it on mount (rather than just rendering it as a
      // history row). encodeURIComponent handles UTF-8 cleanly.
      router.push(`/chats/${chat.id}?q=${encodeURIComponent(trimmed)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create chat.');
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 className="card__title">Ask a question</h2>
      <form onSubmit={onSubmit}>
        <label className="field">
          <span className="field__label">Your question</span>
          <textarea
            className="textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What does the report say about Q3?"
            rows={3}
            required
          />
        </label>
        <div className="form-actions">
          <button type="submit" className="btn" disabled={busy || content.trim().length === 0}>
            {busy ? 'Starting…' : 'Start chat'}
          </button>
        </div>
      </form>
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
