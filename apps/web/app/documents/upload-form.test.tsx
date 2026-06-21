// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { UploadForm } from './upload-form';

// Walks the 3-step upload (sign → PUT → finalize) with successful responses.
function uploadFetch() {
  return vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith('/api/documents/uploads')) {
      return new Response(JSON.stringify({ upload_id: 'u1', signed_url: 'http://localhost/sign' }), {
        status: 200,
      });
    }
    if (u === 'http://localhost/sign') return new Response(null, { status: 200 });
    if (u.endsWith('/api/documents')) return new Response(JSON.stringify({ id: 'd1' }), { status: 201 });
    return new Response(null, { status: 404 });
  });
}

beforeEach(() => refresh.mockReset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('UploadForm', () => {
  it('completes the upload and resets the form without the currentTarget null crash', async () => {
    // Regression: the handler resets the form *after* awaiting fetch. Reading
    // `event.currentTarget` post-await is null, which threw
    // "Cannot read properties of null (reading 'reset')" → caught → error box.
    // The fix captures the form element before the first await, so we should see
    // success, not an error.
    const fetchMock = uploadFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<UploadForm />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const pdf = new File([new Uint8Array([1, 2, 3])], 'report.pdf', { type: 'application/pdf' });
    // happy-dom won't accept assignment to the read-only `files` via fireEvent's
    // target shorthand — define it directly, then fire the change.
    Object.defineProperty(fileInput, 'files', { value: [pdf], configurable: true });
    fireEvent.change(fileInput);
    // happy-dom doesn't submit a form when its submit button is clicked, so
    // fire submit on the form directly (also gives onSubmit a real currentTarget).
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    // Success now shows a live ingestion badge (starts at "pending" and then
    // advances via SSE) instead of a static message.
    const badge = await screen.findByTestId('ingestion-state');
    expect(badge.textContent).toBe('pending');
    expect(screen.queryByRole('alert')).toBeNull(); // no error box
    // The three upload steps fired (sign → PUT → finalize); the badge may also
    // open an ingestion-events stream, so assert the steps rather than a count.
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.endsWith('/api/documents/uploads')).length).toBe(1);
    expect(urls.filter((u) => u === 'http://localhost/sign').length).toBe(1);
    expect(urls.filter((u) => u.endsWith('/api/documents')).length).toBe(1);
    expect(refresh).toHaveBeenCalled();
  });
});
