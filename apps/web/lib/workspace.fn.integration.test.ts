// SPDX-License-Identifier: Apache-2.0
// Covers getCurrentWorkspace() itself (the existing workspace.integration.test
// asserts the auto-provision SQL, not the function).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { adminClient, anonClient, signedInUser, type TestUser } from '../test/integration-helpers';

vi.mock('./supabase/server', () => ({ createSSRClient: vi.fn() }));

import { createSSRClient } from './supabase/server';
import { getCurrentWorkspace } from './workspace';

const admin = adminClient();
let alice: TestUser;

beforeAll(async () => {
  alice = await signedInUser(admin, 'alice');
});

describe('getCurrentWorkspace (integration)', () => {
  it('returns the signed-in user\'s workspace', async () => {
    vi.mocked(createSSRClient).mockResolvedValue(alice.client as never);
    const ws = await getCurrentWorkspace();
    expect(ws?.id).toBe(alice.workspaceId);
  });

  it('returns null when there is no workspace row (anonymous)', async () => {
    // An anon client with no session: the RLS-scoped .single() finds no row.
    vi.mocked(createSSRClient).mockResolvedValue(anonClient() as never);
    expect(await getCurrentWorkspace()).toBeNull();
  });
});
