// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { DocumentHistory } from './document-history';

const events = [
  {
    id: 'e1',
    document_id: 'd1',
    event: 'state_changed',
    from_state: 'pending',
    to_state: 'extracting',
    occurred_at: '2026-06-21T10:00:00.000Z',
    error: null,
  },
  {
    id: 'e2',
    document_id: 'd1',
    event: 'failed',
    from_state: 'extracting',
    to_state: 'failed',
    occurred_at: '2026-06-21T10:00:05.000Z',
    error: { detail: 'OCR provider blocked this document' },
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DocumentHistory', () => {
  it('renders the uploaded entry plus loaded events with friendly labels', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ items: events }), { status: 200 })),
    );
    render(<DocumentHistory documentId="d1" uploadedAt="2026-06-21T09:59:00.000Z" />);

    expect(screen.getByText('Uploaded')).toBeTruthy(); // always-present first entry
    await waitFor(() => expect(screen.getByText('Extracting text')).toBeTruthy());
    expect(screen.getByText('Failed')).toBeTruthy();
    // Non-verbose: no raw from→to transition text.
    expect(screen.queryByText(/pending → extracting/)).toBeNull();
  });

  it('reveals transitions and error detail in verbose mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ items: events }), { status: 200 })),
    );
    render(<DocumentHistory documentId="d1" uploadedAt="2026-06-21T09:59:00.000Z" />);
    await waitFor(() => expect(screen.getByText('Extracting text')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Verbose'));
    expect(screen.getByText(/pending → extracting/)).toBeTruthy();
    expect(screen.getByText(/OCR provider blocked this document/)).toBeTruthy();
  });
});
