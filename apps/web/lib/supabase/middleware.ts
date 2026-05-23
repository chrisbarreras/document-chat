// SPDX-License-Identifier: Apache-2.0
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const AUTH_PAGES = new Set(['/login', '/signup']);

/**
 * Refresh the Supabase session on each request and keep the auth cookies in
 * sync (the canonical @supabase/ssr middleware pattern). Also bounces a
 * signed-in user away from the auth pages.
 *
 * If the Supabase env vars are absent the whole step is skipped, so the app
 * still serves anonymously until a project is provisioned (see docs/deploy.md).
 * IMPORTANT: always return the `supabaseResponse` object unchanged so the
 * refreshed cookies reach the browser.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // Do not run code between createServerClient and getUser() — it refreshes the
  // token and, via setAll above, updates the response cookies.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && AUTH_PAGES.has(request.nextUrl.pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/';
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}
