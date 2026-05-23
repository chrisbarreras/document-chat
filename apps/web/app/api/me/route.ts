// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from 'next/server';
import type { components } from '@document-chat/contracts';
import { getOptionalUser } from '../../../lib/auth';
import { getCurrentWorkspace } from '../../../lib/workspace';
import { problemResponse, unauthorized } from '../../../lib/problem';

type MeResponse = components['schemas']['MeResponse'];

export async function GET(): Promise<NextResponse> {
  const user = await getOptionalUser();
  if (!user) {
    return unauthorized('Sign in to access this resource.');
  }

  const workspace = await getCurrentWorkspace();
  if (!workspace) {
    // The signup trigger provisions a workspace for every user, so this only
    // happens for accounts created before the trigger existed.
    return problemResponse({
      status: 500,
      code: 'workspace.not_provisioned',
      title: 'Workspace not provisioned',
      detail: 'No workspace exists for this user.',
    });
  }

  const email = user.email ?? '';
  const displayName =
    typeof user.user_metadata?.display_name === 'string'
      ? user.user_metadata.display_name
      : undefined;

  const body: MeResponse = {
    user: {
      id: user.id,
      email,
      ...(displayName ? { display_name: displayName } : {}),
    },
    workspace,
    roles: ['member'],
  };

  return NextResponse.json(body);
}
