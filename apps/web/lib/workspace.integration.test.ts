// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

// Requires a running local Supabase stack (`pnpm db:start`) with
// NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY +
// SUPABASE_SERVICE_ROLE_KEY in the environment.
//
// Proves the workspaces migration end to end: the on_auth_user_created trigger
// provisions exactly one workspace per new user, and RLS isolates it so a user
// sees only their own.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function makeClient(key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
  });
}

const PASSWORD = 'Password123!';

async function createConfirmedUser(admin: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  expect(error).toBeNull();
  return data.user!.id;
}

describe('workspaces (integration: auto-provision + RLS)', () => {
  it('provisions one workspace per user and isolates it by RLS', async () => {
    const admin = makeClient(serviceKey);
    const emailA = `a-${crypto.randomUUID()}@example.com`;
    const emailB = `b-${crypto.randomUUID()}@example.com`;

    const userAId = await createConfirmedUser(admin, emailA);
    await createConfirmedUser(admin, emailB);

    // Sign in as A; subsequent reads run under A's JWT (RLS).
    const clientA = makeClient(anonKey);
    const { error: signInError } = await clientA.auth.signInWithPassword({
      email: emailA,
      password: PASSWORD,
    });
    expect(signInError).toBeNull();

    const { data: rows, error } = await clientA
      .from('workspaces')
      .select('id, owner_id, slug');
    expect(error).toBeNull();
    // Exactly one row (auto-provisioned), and it belongs to A — B's is hidden.
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.owner_id).toBe(userAId);
  });
});
