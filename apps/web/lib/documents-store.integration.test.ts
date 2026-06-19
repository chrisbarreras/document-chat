// SPDX-License-Identifier: Apache-2.0
// Exercises the real documents-store functions against local Supabase by
// injecting authenticated clients (see docs/testing-integration-plan.md).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { adminClient, signedInUser, type TestUser } from '../test/integration-helpers';

vi.mock('./supabase/server', () => ({ createSSRClient: vi.fn() }));
vi.mock('./supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createSSRClient } from './supabase/server';
import { createAdminClient } from './supabase/admin';
import {
  insertDocument,
  listDocuments,
  getDocumentRow,
  updateDocumentRow,
  deleteDocumentAndObject,
  mintUploadUrl,
  findUploadedObject,
  type NewDocument,
} from './documents-store';

const admin = adminClient();
let alice: TestUser;
let bob: TestUser;

function asUser(u: TestUser): void {
  vi.mocked(createSSRClient).mockResolvedValue(u.client as never);
}

function newDoc(u: TestUser, title = 'Doc'): NewDocument {
  return {
    workspaceId: u.workspaceId,
    title,
    version: '1.0',
    status: 'current',
    effectiveDate: null,
    sizeBytes: 2048,
    contentType: 'application/pdf',
    storageObjectKey: `${u.workspaceId}/${crypto.randomUUID()}.pdf`,
    uploadedBy: u.userId,
  };
}

beforeAll(async () => {
  vi.mocked(createAdminClient).mockReturnValue(admin as never);
  alice = await signedInUser(admin, 'alice');
  bob = await signedInUser(admin, 'bob');
});

describe('documents-store (integration)', () => {
  it('inserts a document in pending and reads it back', async () => {
    asUser(alice);
    const row = await insertDocument(newDoc(alice, 'Quarterly report'));
    expect(row).not.toBeNull();
    expect(row!.ingestion_state).toBe('pending');
    expect(row!.title).toBe('Quarterly report');

    expect((await getDocumentRow(row!.id))?.id).toBe(row!.id);
  });

  it('scopes reads/updates/deletes by RLS', async () => {
    asUser(alice);
    const row = await insertDocument(newDoc(alice));

    asUser(bob);
    expect(await getDocumentRow(row!.id)).toBeNull();
    expect(await updateDocumentRow(row!.id, { status: 'retired' })).toBeNull();
    expect(await deleteDocumentAndObject(row!.id)).toBe(false);

    asUser(alice);
    expect((await getDocumentRow(row!.id))?.status).toBe('current');
  });

  it('paginates with an opaque cursor and filters by query', async () => {
    asUser(alice);
    const tag = crypto.randomUUID();
    for (let i = 0; i < 3; i++) await insertDocument(newDoc(alice, `${tag}-${i}`));

    const page1 = await listDocuments({ q: tag, sort: 'uploaded_at', ascending: false, limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listDocuments({
      q: tag,
      sort: 'uploaded_at',
      ascending: false,
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
  });

  it('applies a partial update', async () => {
    asUser(alice);
    const row = await insertDocument(newDoc(alice));
    const updated = await updateDocumentRow(row!.id, { status: 'retired' });
    expect(updated?.status).toBe('retired');
  });

  it('deletes a document the owner owns', async () => {
    asUser(alice);
    const row = await insertDocument(newDoc(alice));
    expect(await deleteDocumentAndObject(row!.id)).toBe(true);
    expect(await getDocumentRow(row!.id)).toBeNull();
  });

  it('mints an upload URL and finds the staged object', async () => {
    const minted = await mintUploadUrl(`${alice.workspaceId}/${crypto.randomUUID()}.pdf`);
    expect(minted?.signedUrl).toMatch(/^https?:\/\//);

    const name = `${crypto.randomUUID()}.pdf`;
    const up = await admin.storage
      .from('documents')
      .upload(
        `${alice.workspaceId}/${name}`,
        new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/pdf' }),
        { contentType: 'application/pdf' },
      );
    expect(up.error).toBeNull();

    const found = await findUploadedObject(alice.workspaceId, name);
    expect(found?.mimetype).toBe('application/pdf');
    expect(found?.size).toBeGreaterThan(0);

    expect(await findUploadedObject(alice.workspaceId, 'does-not-exist.pdf')).toBeNull();
  });
});
