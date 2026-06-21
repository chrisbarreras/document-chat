// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { UploadForm } from './upload-form';

// Walks the 3-step upload (sign → PUT → finalize); finalize returns a distinct
// id per call so multiple files get distinct documents.
function uploadFetch() {
  let n = 0;
  return vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith('/api/documents/uploads')) {
      return new Response(JSON.stringify({ upload_id: `u${n}`, signed_url: 'http://localhost/sign' }), {
        status: 200,
      });
    }
    if (u === 'http://localhost/sign') return new Response(null, { status: 200 });
    if (u.endsWith('/api/documents')) {
      return new Response(JSON.stringify({ id: `d${n++}` }), { status: 201 });
    }
    return new Response(null, { status: 404 }); // ingestion-events badge stream
  });
}

function setFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input);
}

beforeEach(() => refresh.mockReset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('UploadForm', () => {
  it('uploads multiple selected PDFs, one row each, ending in a live badge', async () => {
    const fetchMock = uploadFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<UploadForm />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.multiple).toBe(true); // multi-select enabled in the dialog

    const pdfs = [
      new File([new Uint8Array([1])], 'a.pdf', { type: 'application/pdf' }),
      new File([new Uint8Array([2])], 'b.pdf', { type: 'application/pdf' }),
    ];
    setFiles(input, pdfs);

    // Both files appear and both reach the "Uploaded" live badge.
    await waitFor(() =>
      expect(container.querySelectorAll('[data-testid="ingestion-state"]')).toHaveLength(2),
    );
    expect(screen.getByText('a.pdf')).toBeTruthy();
    expect(screen.getByText('b.pdf')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    // Two finalize calls (one per file).
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.endsWith('/api/documents')).length).toBe(2);
    expect(refresh).toHaveBeenCalled();
  });

  it('ignores non-PDF files', async () => {
    const fetchMock = uploadFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<UploadForm />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    setFiles(input, [new File(['x'], 'notes.txt', { type: 'text/plain' })]);
    // No upload list rendered, no fetches fired.
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
    expect(container.querySelector('[data-testid="upload-list"]')).toBeNull();
  });

  it('shows a per-file error when finalize fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.endsWith('/api/documents/uploads'))
          return new Response(JSON.stringify({ upload_id: 'u', signed_url: 'http://localhost/sign' }), {
            status: 200,
          });
        if (u === 'http://localhost/sign') return new Response(null, { status: 200 });
        if (u.endsWith('/api/documents'))
          return new Response(JSON.stringify({ detail: 'Could not finalize the document.' }), {
            status: 500,
          });
        return new Response(null, { status: 404 });
      }),
    );
    const { container } = render(<UploadForm />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    setFiles(input, [new File([new Uint8Array([1])], 'a.pdf', { type: 'application/pdf' })]);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not finalize the document.');
  });
});
