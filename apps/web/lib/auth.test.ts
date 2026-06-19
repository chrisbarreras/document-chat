// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { User } from '@supabase/supabase-js';

vi.mock('./supabase/server', () => ({ createSSRClient: vi.fn() }));
import { createSSRClient } from './supabase/server';
import { isSupabaseConfigured, getOptionalUser } from './auth';

const ORIG_ENV = { ...process.env };
const user = { id: '00000000-0000-0000-0000-000000000001' } as User;

function mockGetUser(result: unknown): void {
  vi.mocked(createSSRClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue(result) },
  } as unknown as Awaited<ReturnType<typeof createSSRClient>>);
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  vi.mocked(createSSRClient).mockReset();
});

afterEach(() => {
  process.env = { ...ORIG_ENV };
});

describe('isSupabaseConfigured', () => {
  it('true when both env vars are present', () => {
    expect(isSupabaseConfigured()).toBe(true);
  });

  it('false when the URL is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(isSupabaseConfigured()).toBe(false);
  });

  it('false when the anon key is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(isSupabaseConfigured()).toBe(false);
  });
});

describe('getOptionalUser', () => {
  it('returns null without touching Supabase when unconfigured', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(await getOptionalUser()).toBeNull();
    expect(createSSRClient).not.toHaveBeenCalled();
  });

  it('returns the user when there is a session', async () => {
    mockGetUser({ data: { user } });
    expect(await getOptionalUser()).toBe(user);
  });

  it('returns null when there is no session', async () => {
    mockGetUser({ data: { user: null } });
    expect(await getOptionalUser()).toBeNull();
  });

  it('returns null (never throws) when the client errors', async () => {
    vi.mocked(createSSRClient).mockRejectedValue(new Error('cookies unavailable'));
    expect(await getOptionalUser()).toBeNull();
  });
});
