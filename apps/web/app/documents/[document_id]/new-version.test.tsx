// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { NewVersionUploader, bumpVersion } from './new-version';

describe('bumpVersion', () => {
  it('increments the leading integer and resets the minor', () => {
    expect(bumpVersion('1.0')).toBe('2.0');
    expect(bumpVersion('3.7')).toBe('4.0');
    expect(bumpVersion('10')).toBe('11.0');
  });
  it('falls back to a -v2 suffix for non-numeric versions', () => {
    expect(bumpVersion('draft')).toBe('draft-v2');
  });
});

function uploadFetch() {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/api/documents/uploads'))
      return new Response(JSON.stringify({ upload_id: 'u1', signed_url: 'http://localhost/sign' }), { status: 200 });
    if (u === 'http://localhost/sign') return new Response(null, { status: 200 });
    if (u.endsWith('/api/documents') && init?.method === 'POST')
      return new Response(JSON.stringify({ id: 'new-doc' }), { status: 201 });
    if (u.endsWith('/api/documents/new-doc') || u.endsWith('/api/documents/old-doc'))
      return new Response(JSON.stringify({ id: 'x' }), { status: 200 }); // PATCH
    return new Response(null, { status: 404 });
  });
}

function setFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

beforeEach(() => push.mockReset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('NewVersionUploader', () => {
  it('uploads, bumps the version on the new doc, retires the old, and navigates', async () => {
    const fetchMock = uploadFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(
      <NewVersionUploader documentId="old-doc" title="Contract" version="1.0" />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    setFile(input, new File([new Uint8Array([1])], 'v2.pdf', { type: 'application/pdf' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/documents/new-doc'));

    const calls = fetchMock.mock.calls.map((c) => ({ url: String(c[0]), init: c[1] as RequestInit }));
    // New doc PATCHed with the bumped version.
    const newPatch = calls.find((c) => c.url.endsWith('/api/documents/new-doc') && c.init?.method === 'PATCH');
    expect(JSON.parse(newPatch!.init.body as string)).toEqual({ version: '2.0' });
    // Old doc retired.
    const oldPatch = calls.find((c) => c.url.endsWith('/api/documents/old-doc') && c.init?.method === 'PATCH');
    expect(JSON.parse(oldPatch!.init.body as string)).toEqual({ status: 'retired' });
    // Finalize inherited the original title.
    const finalize = calls.find((c) => c.url.endsWith('/api/documents') && c.init?.method === 'POST');
    expect(JSON.parse(finalize!.init.body as string).title).toBe('Contract');
  });
});
