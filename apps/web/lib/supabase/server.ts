// SPDX-License-Identifier: Apache-2.0
import { createServerClient } from '@supabase/ssr';
import { cookies, headers } from 'next/headers';

/**
 * Cookie-bound Supabase client for the Next.js App Router (RSC, Route
 * Handlers, Server Actions). Carries the signed-in user's session via
 * cookies and respects Row-Level Security.
 *
 * Programmatic API clients (e.g. the eval harness) authenticate with an
 * `Authorization: Bearer <jwt>` header instead of session cookies. When that
 * header is present it is forwarded on every PostgREST/Auth call, so RLS sees
 * the caller exactly as it would for a cookie-based browser session. Browser
 * requests carry no such header and continue to use cookies.
 */
export async function createSSRClient() {
  const cookieStore = await cookies();
  const authHeader = (await headers()).get('authorization');
  const bearer = authHeader && /^Bearer\s+\S/i.test(authHeader) ? authHeader : undefined;

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(bearer ? { global: { headers: { Authorization: bearer } } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component where cookies are read-only.
            // Session refresh is handled by middleware instead (Tier 1).
          }
        },
      },
    },
  );
}
