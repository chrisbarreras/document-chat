'use client';
// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { components } from '@document-chat/contracts';

type IngestionEvent = components['schemas']['IngestionEvent'];

const TERMINAL = new Set(['ready', 'failed']);

export interface IngestionPanelProps {
  documentId: string;
  initialState: string;
  initialError: string | null;
}

/**
 * Live ingestion-state panel. Opens an SSE stream against
 * `/api/documents/{id}/ingestion-events`, accumulates events into a
 * chronological log, and exposes a "Reprocess" button that calls
 * `POST /api/documents/{id}:reprocess` and re-opens the stream.
 *
 * Once the document is `ready` or `failed`, the stream closes itself and
 * the button stays available for re-runs (REQ-1.2.5).
 */
export function IngestionPanel({ documentId, initialState, initialError }: IngestionPanelProps) {
  const router = useRouter();
  const [currentState, setCurrentState] = useState(initialState);
  const [currentError, setCurrentError] = useState<string | null>(initialError);
  const [events, setEvents] = useState<IngestionEvent[]>([]);
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessError, setReprocessError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const openStream = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let res: Response;
    try {
      res = await fetch(`/api/documents/${documentId}/ingestion-events`, {
        method: 'GET',
        headers: { accept: 'text/event-stream' },
        signal: controller.signal,
      });
    } catch {
      return;
    }
    if (!res.ok || !res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let streaming = true;
    try {
      while (streaming) {
        const { value, done } = await reader.read();
        if (done) {
          streaming = false;
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let frameEnd = buffer.indexOf('\n\n');
        while (frameEnd !== -1) {
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);
          frameEnd = buffer.indexOf('\n\n');
          const parsed = parseFrame(frame);
          if (parsed) applyEvent(parsed);
        }
      }
    } catch {
      // Stream interrupted or aborted; the user can navigate away or
      // reprocess to retry.
    } finally {
      reader.releaseLock();
    }

    function applyEvent(event: IngestionEvent) {
      setEvents((prev) => [...prev, event]);
      if (event.to_state) setCurrentState(event.to_state);
      if (event.event === 'failed') {
        const detail =
          (event.error as { detail?: string } | undefined)?.detail ??
          (event.error as { title?: string } | undefined)?.title ??
          'Ingestion failed.';
        setCurrentError(detail);
      } else if (event.event === 'state_changed') {
        // A successful transition clears any prior error display.
        setCurrentError(null);
      }
    }
  }, [documentId]);

  useEffect(() => {
    if (TERMINAL.has(currentState)) return;
    void openStream();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

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
      setCurrentState('pending');
      setCurrentError(null);
      setEvents([]);
      // Re-open the SSE stream to watch the new run.
      void openStream();
      // Refresh the server-rendered metadata.
      router.refresh();
    } catch (err) {
      setReprocessError(err instanceof Error ? err.message : 'Reprocess failed.');
    } finally {
      setReprocessing(false);
    }
  }

  return (
    <section data-testid="ingestion-panel">
      <h2>Processing</h2>
      <p>
        <span data-testid="ingestion-state">{currentState}</span>
        {currentError ? <span> — {currentError}</span> : null}
      </p>
      <button type="button" onClick={onReprocess} disabled={reprocessing}>
        {reprocessing ? 'Reprocessing…' : 'Reprocess'}
      </button>
      {reprocessError ? <p role="alert">{reprocessError}</p> : null}
      {events.length > 0 ? (
        <details>
          <summary>{events.length} event{events.length === 1 ? '' : 's'}</summary>
          <ol>
            {events.map((event) => (
              <li key={event.id}>
                <code>{event.event}</code>
                {event.to_state ? ` → ${event.to_state}` : ''}
                <small>
                  {' '}
                  ({new Date(event.occurred_at).toLocaleTimeString()})
                </small>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}

function parseFrame(frame: string): IngestionEvent | null {
  let dataLine: string | null = null;
  let isCommentOnly = true;
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue;
    isCommentOnly = false;
    if (line.startsWith('data:')) dataLine = line.slice('data:'.length).trim();
  }
  if (isCommentOnly || !dataLine) return null;
  try {
    return JSON.parse(dataLine) as IngestionEvent;
  } catch {
    return null;
  }
}
