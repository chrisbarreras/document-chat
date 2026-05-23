// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

// Requires a running local Supabase stack (`pnpm db:start`) with
// NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY in the environment.
// Proves the local Auth (GoTrue) config supports the email/password signup the
// auth UI relies on: signups are enabled and, with email confirmations off
// locally (supabase/config.toml), return a session immediately.
describe('supabase auth (integration)', () => {
  it('signs up with email/password and returns a session', async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        // Node 20 has no global WebSocket; supabase-js eagerly builds a Realtime
        // client whose constructor needs one. We never open a socket here.
        realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
      },
    );

    const email = `it-${crypto.randomUUID()}@example.com`;
    const { data, error } = await supabase.auth.signUp({ email, password: 'Password123!' });

    expect(error).toBeNull();
    expect(data.user?.email).toBe(email);
    // Confirmations are disabled locally, so a session is issued on signup.
    expect(data.session).not.toBeNull();
  });
});
