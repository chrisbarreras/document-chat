// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { IngestionBadge } from './ingestion-badge';

// Minimal SSE-ish response: the hook only reads `.ok` and `.body.getReader()`.
function sseResponse(frames: string[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(frames.join('')));
      controller.close();
    },
  });
  return { ok: true, body };
}

function frame(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('IngestionBadge', () => {
  it('advances the badge as ingestion events stream in', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        frame({ id: 'e1', document_id: 'd1', event: 'state_changed', to_state: 'chunking', occurred_at: 'now' }),
        frame({ id: 'e2', document_id: 'd1', event: 'state_changed', to_state: 'embedding', occurred_at: 'now' }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<IngestionBadge documentId="d1" initialState="extracting" />);
    // Renders the server-provided state immediately…
    expect(screen.getByTestId('ingestion-state').textContent).toBe('extracting');
    // …then advances as events arrive.
    await waitFor(() => expect(screen.getByTestId('ingestion-state').textContent).toBe('embedding'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/documents/d1/ingestion-events',
      expect.objectContaining({ headers: { accept: 'text/event-stream' } }),
    );
  });

  it('shows the failure error and does not open a stream once terminal', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<IngestionBadge documentId="d1" initialState="failed" initialError="OCR blocked" showError />);
    expect(screen.getByTestId('ingestion-state').textContent).toBe('failed');
    expect(screen.getByText(/OCR blocked/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
