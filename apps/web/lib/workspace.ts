// SPDX-License-Identifier: Apache-2.0
import type { components } from '@document-chat/contracts';
import { createSSRClient } from './supabase/server';

type Workspace = components['schemas']['Workspace'];

/**
 * The current user's workspace, read with the cookie-bound (RLS-scoped)
 * client — the `workspaces_select_own` policy returns only the caller's row,
 * so `.single()` resolves it. Returns null when not signed in, not yet
 * provisioned, or auth is not configured. Never throws.
 */
export async function getCurrentWorkspace(): Promise<Workspace | null> {
  try {
    const supabase = await createSSRClient();
    const { data, error } = await supabase
      .from('workspaces')
      .select('id, name, slug, created_at, updated_at')
      .single();
    if (error || !data) return null;
    return data as Workspace;
  } catch {
    return null;
  }
}
