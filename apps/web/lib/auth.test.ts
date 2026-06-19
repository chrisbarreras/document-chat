// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { User } from '@supabase/supabase-js';

vi.mock('./supabase/server', () => ({ createSSRClient: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn() }));
import { createSSRClient } from './supabase/server';
import { headers } from 'next/headers';
import { isSupabaseConfigured, getOptionalUser } from './auth';

const ORIG_ENV = { ...process.env };
const user = { id: '00000000-0000-0000-0000-000000000001' } as User;

function setAuthHeader(value: string | null): void {
  vi.mocked(headers).mockResolvedValue(
    new Headers(value ? { authorization: value } : {}) as never,
  );
}

// Wire createSSRClient to a fake whose auth.getUser returns `result`; returns
// the getUser mock so tests can assert how it was called.
function mockGetUser(result: unknown) {
  const getUser = vi.fn().mockResolvedValue(result);
  vi.mocked(createSSRClient).mockResolvedValue({ auth: { getUser } } as never);
  return getUser;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  vi.mocked(createSSRClient).mockReset();
  vi.mocked(headers).mockReset();
  setAuthHeader(null); // default: no Authorization header (cookie-session path)
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

  it('returns the cookie-session user when there is no Authorization header', async () => {
    const getUser = mockGetUser({ data: { user } });
    expect(await getOptionalUser()).toBe(user);
    expect(getUser).toHaveBeenCalledWith();
  });

  it('validates a Bearer token directly when one is present', async () => {
    setAuthHeader('Bearer tok-123');
    const getUser = mockGetUser({ data: { user } });
    expect(await getOptionalUser()).toBe(user);
    expect(getUser).toHaveBeenCalledWith('tok-123');
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
