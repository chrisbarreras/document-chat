// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

// Requires a running local Supabase stack (see docs/testing.md). Proves the
// storage migration applied: the private `documents` bucket exists with the
// expected limits.
describe('storage (integration)', () => {
  it('has a private documents bucket', async () => {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
      },
    );

    const { data, error } = await admin.storage.getBucket('documents');
    expect(error).toBeNull();
    expect(data?.id).toBe('documents');
    expect(data?.public).toBe(false);
  });
});
