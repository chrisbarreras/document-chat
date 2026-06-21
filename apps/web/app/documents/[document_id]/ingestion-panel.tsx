'use client';
// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useIngestionStatus } from '../use-ingestion-status';

export interface IngestionPanelProps {
  documentId: string;
  initialState: string;
  initialError: string | null;
}

/**
 * Live ingestion-state panel. Subscribes (via {@link useIngestionStatus}) to
 * `/api/documents/{id}/ingestion-events`, shows a chronological event log, and
 * exposes a "Reprocess" button that calls `POST /api/documents/{id}:reprocess`
 * and re-opens the stream.
 *
 * Once the document is `ready` or `failed`, the stream closes itself and
 * the button stays available for re-runs (REQ-1.2.5).
 */
export function IngestionPanel({ documentId, initialState, initialError }: IngestionPanelProps) {
  const router = useRouter();
  const { state: currentState, error: currentError, events, restart } = useIngestionStatus(
    documentId,
    initialState,
    initialError,
  );
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessError, setReprocessError] = useState<string | null>(null);

  async function onReprocess() {
    setReprocessing(true);
    setReprocessError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}:reprocess`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail ?? 'Reprocess failed.');
      }
      // Reset to a fresh run and re-open the stream to watch it.
      restart('pending');
      // Refresh the server-rendered metadata.
      router.refresh();
    } catch (err) {
      setReprocessError(err instanceof Error ? err.message : 'Reprocess failed.');
    } finally {
      setReprocessing(false);
    }
  }

  return (
    <section data-testid="ingestion-panel" className="card page-section">
      <div className="row row--space-between">
        <h2 className="card__title" style={{ margin: 0 }}>
          Processing
        </h2>
        <button
          type="button"
          onClick={onReprocess}
          disabled={reprocessing}
          className="btn btn--secondary btn--sm"
        >
          {reprocessing ? 'Reprocessing…' : 'Reprocess'}
        </button>
      </div>
      <p style={{ marginTop: '0.75rem' }}>
        <span className={`badge badge--${currentState}`} data-testid="ingestion-state">
          {currentState}
        </span>
        {currentError ? <span className="muted"> — {currentError}</span> : null}
      </p>
      {reprocessError ? (
        <p role="alert" className="alert">
          {reprocessError}
        </p>
      ) : null}
      {events.length > 0 ? (
        <details>
          <summary>
            {events.length} event{events.length === 1 ? '' : 's'}
          </summary>
          <ol className="event-log">
            {events.map((event) => (
              <li key={event.id}>
                <code>{event.event}</code>
                {event.to_state ? <span className="muted">→ {event.to_state}</span> : null}
                <small>{new Date(event.occurred_at).toLocaleTimeString()}</small>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
