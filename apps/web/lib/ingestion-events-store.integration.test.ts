// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { adminClient, signedInUser, seedDocument, type TestUser } from '../test/integration-helpers';

vi.mock('./supabase/server', () => ({ createSSRClient: vi.fn() }));

import { createSSRClient } from './supabase/server';
import { listIngestionEvents, getEventsSince } from './ingestion-events-store';

const admin = adminClient();
let alice: TestUser;
let docId: string;

function asUser(u: TestUser): void {
  vi.mocked(createSSRClient).mockResolvedValue(u.client as never);
}

beforeAll(async () => {
  alice = await signedInUser(admin, 'alice');
  docId = await seedDocument(alice.client, { workspaceId: alice.workspaceId, userId: alice.userId });
  // Seed an event timeline via the admin client (mirrors the Inngest pipeline).
  const { error } = await admin.from('ingestion_events').insert([
    { document_id: docId, event: 'state_changed', from_state: 'pending', to_state: 'extracting' },
    { document_id: docId, event: 'chunk_extracted', progress_processed: 1, progress_total: 3 },
    { document_id: docId, event: 'state_changed', from_state: 'extracting', to_state: 'chunking' },
  ]);
  expect(error).toBeNull();
});

describe('ingestion-events-store (integration)', () => {
  it('lists events oldest-first with cursor pagination', async () => {
    asUser(alice);
    const page1 = await listIngestionEvents({ documentId: docId, limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listIngestionEvents({ documentId: docId, limit: 2, cursor: page1.nextCursor! });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
  });

  it('returns all events when no cursor is given', async () => {
    asUser(alice);
    expect(await getEventsSince(docId, null, null)).toHaveLength(3);
  });

  it('returns only events after the (occurred_at, id) cursor', async () => {
    asUser(alice);
    const all = await getEventsSince(docId, null, null);
    const first = all[0]!;
    const rest = await getEventsSince(docId, first.occurred_at, first.id);
    expect(rest).toHaveLength(2);
    expect(rest.map((e) => e.id)).not.toContain(first.id);
  });
});
