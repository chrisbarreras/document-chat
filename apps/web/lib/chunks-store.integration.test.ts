// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { adminClient, signedInUser, seedDocument, seedChunks, type TestUser } from '../test/integration-helpers';

vi.mock('./supabase/server', () => ({ createSSRClient: vi.fn() }));

import { createSSRClient } from './supabase/server';
import { listDocumentChunks, getChunkRow, fetchChunksForCitations } from './chunks-store';

const admin = adminClient();
let alice: TestUser;
let bob: TestUser;
let docId: string;
let chunkIds: string[];

function asUser(u: TestUser): void {
  vi.mocked(createSSRClient).mockResolvedValue(u.client as never);
}

beforeAll(async () => {
  alice = await signedInUser(admin, 'alice');
  bob = await signedInUser(admin, 'bob');
  docId = await seedDocument(alice.client, { workspaceId: alice.workspaceId, userId: alice.userId });
  chunkIds = await seedChunks(admin, docId, 3);
});

describe('chunks-store (integration)', () => {
  it('lists chunks in index order with cursor pagination', async () => {
    asUser(alice);
    const page1 = await listDocumentChunks({ documentId: docId, limit: 2 });
    expect(page1.items.map((c) => c.index)).toEqual([0, 1]);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listDocumentChunks({ documentId: docId, limit: 2, cursor: page1.nextCursor! });
    expect(page2.items.map((c) => c.index)).toEqual([2]);
    expect(page2.nextCursor).toBeNull();
  });

  it('gets a single chunk and returns null for an unknown id', async () => {
    asUser(alice);
    expect((await getChunkRow(chunkIds[0]!))?.id).toBe(chunkIds[0]);
    expect(await getChunkRow(crypto.randomUUID())).toBeNull();
  });

  it('resolves citation chunks + parent docs, dropping ids it cannot see', async () => {
    asUser(alice);
    expect((await fetchChunksForCitations([])).chunks).toHaveLength(0);

    const resolved = await fetchChunksForCitations([chunkIds[0]!, chunkIds[1]!, crypto.randomUUID()]);
    expect(resolved.chunks).toHaveLength(2);
    expect(resolved.documents.get(docId)?.title).toBeTruthy();
  });

  it('hides another workspace\'s chunks via RLS', async () => {
    asUser(bob);
    expect(await getChunkRow(chunkIds[0]!)).toBeNull();
    expect((await listDocumentChunks({ documentId: docId, limit: 10 })).items).toHaveLength(0);
    expect((await fetchChunksForCitations([chunkIds[0]!])).chunks).toHaveLength(0);
  });
});
