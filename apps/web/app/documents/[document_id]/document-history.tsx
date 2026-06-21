'use client';
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react';
import type { components } from '@document-chat/contracts';

type IngestionEvent = components['schemas']['IngestionEvent'];

// Friendly, human-readable labels for the persisted lifecycle. Unlike the live
// Processing panel (which only has events from the current run), this loads the
// full history from the JSON endpoint, so it also works for documents that are
// already `ready`/`failed`.
const STATE_LABEL: Record<string, string> = {
  pending: 'Queued for processing',
  extracting: 'Extracting text',
  chunking: 'Chunking',
  embedding: 'Embedding',
  ready: 'Ready',
  failed: 'Failed',
};

function label(ev: IngestionEvent): string {
  if (ev.event === 'failed') return 'Failed';
  if (ev.to_state) return STATE_LABEL[ev.to_state] ?? ev.to_state;
  return ev.event;
}

export interface DocumentHistoryProps {
  documentId: string;
  /** Document creation time — rendered as the first ("Uploaded") entry. */
  uploadedAt: string;
}

/**
 * Full, persisted ingestion timeline for a document: when it was uploaded and
 * every state transition since (including reprocesses). A "Verbose" toggle
 * reveals from→to transitions and error detail.
 */
export function DocumentHistory({ documentId, uploadedAt }: DocumentHistoryProps) {
  const [events, setEvents] = useState<IngestionEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verbose, setVerbose] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/documents/${documentId}/ingestion-events?limit=100`, {
          headers: { accept: 'application/json' },
        });
        if (!res.ok) throw new Error('Could not load history.');
        const body = (await res.json()) as { items: IngestionEvent[] };
        if (active) setEvents(body.items);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Could not load history.');
      }
    })();
    return () => {
      active = false;
    };
  }, [documentId]);

  return (
    <section data-testid="document-history" className="card page-section">
      <div className="row row--space-between">
        <h2 className="card__title" style={{ margin: 0 }}>
          History
        </h2>
        <label className="muted" style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center' }}>
          <input type="checkbox" checked={verbose} onChange={(e) => setVerbose(e.target.checked)} />
          Verbose
        </label>
      </div>

      {error ? <p className="muted">{error}</p> : null}

      <ol className="event-log" style={{ marginTop: '0.75rem' }}>
        <li>
          <code>Uploaded</code>
          <small>{new Date(uploadedAt).toLocaleString()}</small>
        </li>
        {(events ?? []).map((ev) => (
          <li key={ev.id}>
            <code>{label(ev)}</code>
            {verbose && ev.from_state && ev.to_state ? (
              <span className="muted">
                {' '}
                {ev.from_state} → {ev.to_state}
              </span>
            ) : null}
            <small>{new Date(ev.occurred_at).toLocaleString()}</small>
            {verbose && ev.event === 'failed' && ev.error ? (
              <div className="muted">
                <small>
                  {(ev.error as { detail?: string } | undefined)?.detail ?? JSON.stringify(ev.error)}
                </small>
              </div>
            ) : null}
          </li>
        ))}
        {events === null && !error ? <li className="muted">Loading…</li> : null}
      </ol>
    </section>
  );
}
