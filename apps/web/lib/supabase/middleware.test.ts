// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }));
import { createServerClient } from '@supabase/ssr';
import { updateSession } from './middleware';

const ORIG_ENV = { ...process.env };

// Wire createServerClient to a fake whose getUser returns `user`, while also
// exercising the cookie getAll/setAll passthrough the real middleware relies on.
function mockClient(user: unknown): void {
  vi.mocked(createServerClient).mockImplementation(((
    _url: string,
    _key: string,
    opts: {
      cookies: {
        getAll: () => unknown;
        setAll: (c: { name: string; value: string; options: Record<string, unknown> }[]) => void;
      };
    },
  ) => {
    opts.cookies.getAll();
    opts.cookies.setAll([{ name: 'sb-access', value: 'token', options: {} }]);
    return { auth: { getUser: async () => ({ data: { user } }) } };
  }) as unknown as typeof createServerClient);
}

function request(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`));
}

function redirectPath(res: { headers: Headers }): string | null {
  const loc = res.headers.get('location');
  return loc ? new URL(loc).pathname : null;
}

const user = { id: '00000000-0000-0000-0000-000000000001' };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  vi.mocked(createServerClient).mockReset();
});

afterEach(() => {
  process.env = { ...ORIG_ENV };
});

describe('updateSession', () => {
  it('skips Supabase entirely when env vars are absent', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const res = await updateSession(request('/documents'));
    expect(res.status).toBe(200);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it('redirects a signed-in user away from /login to /', async () => {
    mockClient(user);
    const res = await updateSession(request('/login'));
    expect(res.status).toBe(307);
    expect(redirectPath(res)).toBe('/');
  });

  it('redirects a signed-in user away from /signup to /', async () => {
    mockClient(user);
    const res = await updateSession(request('/signup'));
    expect(redirectPath(res)).toBe('/');
  });

  it('redirects an anonymous user from a protected page to /login', async () => {
    mockClient(null);
    const res = await updateSession(request('/documents'));
    expect(res.status).toBe(307);
    expect(redirectPath(res)).toBe('/login');
  });

  it('redirects an anonymous user from a nested protected path to /login', async () => {
    mockClient(null);
    const res = await updateSession(request('/chats/abc-123'));
    expect(redirectPath(res)).toBe('/login');
  });

  it('lets a signed-in user through to a protected page', async () => {
    mockClient(user);
    const res = await updateSession(request('/documents'));
    expect(res.status).toBe(200);
    expect(redirectPath(res)).toBeNull();
  });

  it('lets an anonymous user through to a public page', async () => {
    mockClient(null);
    const res = await updateSession(request('/'));
    expect(res.status).toBe(200);
    expect(redirectPath(res)).toBeNull();
  });
});
