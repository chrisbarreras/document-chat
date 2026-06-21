// SPDX-License-Identifier: Apache-2.0
//
// Shared client hook for live document ingestion status. Subscribes to the
// `/api/documents/{id}/ingestion-events` SSE stream, tracks the current state /
// error / event log, and self-closes once the document reaches a terminal
// state. Used by the documents list, the detail-page header chip, the upload
// form, and the full ingestion panel so every status indicator advances live.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { components } from '@document-chat/contracts';

type IngestionEvent = components['schemas']['IngestionEvent'];

const TERMINAL = new Set(['ready', 'failed']);

export interface UseIngestionStatus {
  state: string;
  error: string | null;
  events: IngestionEvent[];
  /** Reset to a fresh run (default `pending`) and re-open the stream. */
  restart: (nextState?: string) => void;
}

export function useIngestionStatus(
  documentId: string,
  initialState: string,
  initialError: string | null = null,
): UseIngestionStatus {
  const [state, setState] = useState(initialState);
  const [error, setError] = useState<string | null>(initialError);
  const [events, setEvents] = useState<IngestionEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  // Read the latest state inside the mount effect without making it a dep.
  const stateRef = useRef(state);
  stateRef.current = state;

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
      // Stream interrupted or aborted; the caller can reprocess to retry.
    } finally {
      reader.releaseLock();
    }

    function applyEvent(event: IngestionEvent) {
      setEvents((prev) => [...prev, event]);
      if (event.to_state) setState(event.to_state);
      if (event.event === 'failed') {
        const detail =
          (event.error as { detail?: string } | undefined)?.detail ??
          (event.error as { title?: string } | undefined)?.title ??
          'Ingestion failed.';
        setError(detail);
      } else if (event.event === 'state_changed') {
        // A successful transition clears any prior error display.
        setError(null);
      }
    }
  }, [documentId]);

  useEffect(() => {
    if (TERMINAL.has(stateRef.current)) return;
    void openStream();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  const restart = useCallback(
    (nextState = 'pending') => {
      setState(nextState);
      setError(null);
      setEvents([]);
      void openStream();
    },
    [openStream],
  );

  return { state, error, events, restart };
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
