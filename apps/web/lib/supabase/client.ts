// SPDX-License-Identifier: Apache-2.0
import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser-side Supabase client for client components (login/signup forms).
 * Reads the public env vars Next inlines into the client bundle. Created on
 * demand inside event handlers so a missing env var surfaces at use time, not
 * at module load / build time.
 */
export function createBrowserSupabaseClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
