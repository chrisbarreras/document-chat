// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '../../../lib/auth';
import { createSSRClient } from '../../../lib/supabase/server';

export async function POST(request: Request): Promise<NextResponse> {
  if (isSupabaseConfigured()) {
    const supabase = await createSSRClient();
    await supabase.auth.signOut();
  }
  // 303 so the browser issues a GET to the login page after the POST.
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
