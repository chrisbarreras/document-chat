// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import type { DocumentRow } from '../../../../../lib/documents';

vi.mock('../../../../../lib/auth', () => ({ getOptionalUser: vi.fn() }));
vi.mock('../../../../../lib/documents-store', () => ({
  getDocumentRow: vi.fn(),
  mintDownloadUrl: vi.fn(),
}));

import { getOptionalUser } from '../../../../../lib/auth';
import { getDocumentRow, mintDownloadUrl } from '../../../../../lib/documents-store';
import { GET } from './route';

const DOC_ID = '22222222-2222-2222-2222-222222222222';
const user = { id: '00000000-0000-0000-0000-000000000001' } as unknown as User;

const row = {
  id: DOC_ID,
  workspace_id: '00000000-0000-0000-0000-0000000000aa',
  title: 'Quarterly / Report',
  storage_object_key: 'ws/doc.pdf',
} as unknown as DocumentRow;

const ctx = { params: Promise.resolve({ document_id: DOC_ID }) };

beforeEach(() => {
  vi.mocked(getOptionalUser).mockResolvedValue(user);
  vi.mocked(getDocumentRow).mockReset().mockResolvedValue(row);
  vi.mocked(mintDownloadUrl)
    .mockReset()
    .mockResolvedValue({ signedUrl: 'https://storage.example/signed?token=abc' });
});

describe('GET /documents/{id}/download', () => {
  it('401 when not signed in', async () => {
    vi.mocked(getOptionalUser).mockResolvedValue(null);
    const res = await GET(new Request('http://localhost'), ctx);
    expect(res.status).toBe(401);
  });

  it('404 when the document is absent', async () => {
    vi.mocked(getDocumentRow).mockResolvedValue(null);
    const res = await GET(new Request('http://localhost'), ctx);
    expect(res.status).toBe(404);
  });

  it('302-redirects to a freshly minted signed URL with a sanitized .pdf filename', async () => {
    const res = await GET(new Request('http://localhost'), ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://storage.example/signed?token=abc');
    // Filename sanitized (slash → _) and given a .pdf extension.
    expect(mintDownloadUrl).toHaveBeenCalledWith('ws/doc.pdf', expect.any(Number), 'Quarterly _ Report.pdf');
  });

  it('502 when the signed URL cannot be minted', async () => {
    vi.mocked(mintDownloadUrl).mockResolvedValue(null);
    const res = await GET(new Request('http://localhost'), ctx);
    expect(res.status).toBe(502);
  });
});
