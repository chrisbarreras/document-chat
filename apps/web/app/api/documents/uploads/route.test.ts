// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import type { components } from '@document-chat/contracts';
import { createSchemaValidator } from '@document-chat/contracts/test-utils';

vi.mock('../../../../lib/auth', () => ({ getOptionalUser: vi.fn() }));
vi.mock('../../../../lib/workspace', () => ({ getCurrentWorkspace: vi.fn() }));
vi.mock('../../../../lib/documents-store', () => ({ mintUploadUrl: vi.fn() }));

import { getOptionalUser } from '../../../../lib/auth';
import { getCurrentWorkspace } from '../../../../lib/workspace';
import { mintUploadUrl } from '../../../../lib/documents-store';
import { POST } from './route';

const validator = await createSchemaValidator();
const user = { id: '00000000-0000-0000-0000-000000000001', email: 'ada@example.com' } as unknown as User;
const workspace: components['schemas']['Workspace'] = {
  id: '00000000-0000-0000-0000-0000000000aa',
  name: "ada's workspace",
  slug: 'ada',
  created_at: '2026-05-20T00:00:00.000Z',
  updated_at: '2026-05-20T00:00:00.000Z',
};

function req(body: unknown): Request {
  return new Request('http://localhost/api/documents/uploads', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.mocked(getOptionalUser).mockResolvedValue(user);
  vi.mocked(getCurrentWorkspace).mockResolvedValue(workspace);
  vi.mocked(mintUploadUrl).mockReset();
  vi.mocked(mintUploadUrl).mockResolvedValue({
    signedUrl: 'http://localhost:54321/storage/v1/object/upload/sign/documents/x?token=t',
  });
});

describe('POST /documents/uploads', () => {
  it('401 when not signed in', async () => {
    vi.mocked(getOptionalUser).mockResolvedValue(null);
    const res = await POST(req({ filename: 'a.pdf', size_bytes: 10, content_type: 'application/pdf' }));
    expect(res.status).toBe(401);
  });

  it('413 when the file exceeds the size limit', async () => {
    const res = await POST(
      req({ filename: 'a.pdf', size_bytes: 60_000_000, content_type: 'application/pdf' }),
    );
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('document.too_large');
  });

  it('415 for a non-PDF content type', async () => {
    const res = await POST(req({ filename: 'a.txt', size_bytes: 10, content_type: 'text/plain' }));
    expect(res.status).toBe(415);
  });

  it('201 with a CreateUploadResponse and an absolute signed URL', async () => {
    const res = await POST(
      req({ filename: 'a.pdf', size_bytes: 1024, content_type: 'application/pdf' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    const result = validator.validate('CreateUploadResponse', body);
    expect(result.valid, JSON.stringify(result.errors)).toBe(true);
    expect(body.storage_object_key).toBe(`${workspace.id}/${body.upload_id}.pdf`);
    expect(body.signed_url).toMatch(/^https?:\/\//);
    expect(body.max_size_bytes).toBe(52_428_800);
  });
});

describe('POST /documents/uploads (validation + failures)', () => {
  it('500 when the workspace is not provisioned', async () => {
    vi.mocked(getCurrentWorkspace).mockResolvedValue(null);
    const res = await POST(req({ filename: 'a.pdf', size_bytes: 10, content_type: 'application/pdf' }));
    expect(res.status).toBe(500);
  });

  it('400 on invalid JSON', async () => {
    const res = await POST(
      new Request('http://localhost/api/documents/uploads', {
        method: 'POST',
        body: '{nope',
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('request.invalid_json');
  });

  it('400 when required fields are missing', async () => {
    expect((await POST(req({ filename: 'a.pdf', content_type: 'application/pdf' }))).status).toBe(400);
    expect((await POST(req({ size_bytes: 10, content_type: 'application/pdf' }))).status).toBe(400);
  });

  it('500 when the signed URL cannot be minted', async () => {
    vi.mocked(mintUploadUrl).mockResolvedValue(null);
    const res = await POST(req({ filename: 'a.pdf', size_bytes: 10, content_type: 'application/pdf' }));
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('storage.signed_url_failed');
  });
});
