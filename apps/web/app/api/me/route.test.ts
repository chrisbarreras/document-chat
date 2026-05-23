// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { createSchemaValidator } from '@document-chat/contracts/test-utils';

// Mock the auth helper so the route can be unit-tested without a real session
// or Supabase stack (those are covered by the integration layer).
vi.mock('../../../lib/auth', () => ({ getOptionalUser: vi.fn() }));
import { getOptionalUser } from '../../../lib/auth';
import { GET } from './route';

const mockedGetOptionalUser = vi.mocked(getOptionalUser);
const validator = await createSchemaValidator();

const fakeUser = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'ada@example.com',
  created_at: '2026-05-20T00:00:00.000Z',
  user_metadata: {},
  app_metadata: {},
  aud: 'authenticated',
} as unknown as User;

beforeEach(() => {
  mockedGetOptionalUser.mockReset();
});

describe('GET /me', () => {
  it('returns 401 Problem when there is no session', async () => {
    mockedGetOptionalUser.mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toMatch(/application\/problem\+json/);

    const body = await res.json();
    const result = validator.validate('Problem', body);
    expect(result.valid, JSON.stringify(result.errors)).toBe(true);
    expect(body.code).toBe('auth.unauthorized');
  });

  it('returns 200 with a MeResponse-shaped body when authenticated', async () => {
    mockedGetOptionalUser.mockResolvedValue(fakeUser);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    const result = validator.validate('MeResponse', body);
    expect(result.valid, JSON.stringify(result.errors)).toBe(true);
    expect(body.user.id).toBe(fakeUser.id);
    expect(body.user.email).toBe('ada@example.com');
    expect(body.roles).toContain('member');
    // Synthesized single workspace is stable on the user id (interim, pre-#3).
    expect(body.workspace.id).toBe(fakeUser.id);
  });
});
