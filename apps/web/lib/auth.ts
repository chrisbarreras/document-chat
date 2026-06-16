// SPDX-License-Identifier: Apache-2.0
import { headers } from 'next/headers';
import type { User } from '@supabase/supabase-js';
import { createSSRClient } from './supabase/server';

/**
 * True when the Supabase env vars are present. Until a Supabase project is
 * provisioned and its env vars are set (locally in `.env.local`, on Vercel in
 * project settings), auth is treated as unconfigured and the app runs
 * anonymously rather than erroring. See docs/deploy.md.
 */
export function isSupabaseConfigured(): boolean {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/**
 * The signed-in user, or null if there is no session or auth is not configured.
 * Never throws — callers can treat null as "anonymous".
 */
export async function getOptionalUser(): Promise<User | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createSSRClient();
    // Bearer-authenticated callers (programmatic API clients) present their
    // JWT in the Authorization header; validate it directly. Cookie-based
    // browser sessions fall through to the session-backed getUser().
    const authHeader = (await headers()).get('authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    const {
      data: { user },
    } = token ? await supabase.auth.getUser(token) : await supabase.auth.getUser();
    return user ?? null;
  } catch {
    return null;
  }
}
