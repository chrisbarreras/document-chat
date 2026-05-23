// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from 'next/server';
import type { components } from '@document-chat/contracts';
import { getOptionalUser } from '../../../lib/auth';
import { unauthorized } from '../../../lib/problem';

type MeResponse = components['schemas']['MeResponse'];

export async function GET(): Promise<NextResponse> {
  const user = await getOptionalUser();
  if (!user) {
    return unauthorized('Sign in to access this resource.');
  }

  const createdAt = user.created_at ?? new Date().toISOString();
  const email = user.email ?? '';
  const localPart = email.split('@')[0] || 'workspace';
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
    // Tier 1 is single-workspace-per-user. Until chunk #3 provisions a real
    // workspace row, synthesize one from the user (id === user.id keeps it
    // stable across requests). The contract shape is unchanged when the real
    // table lands.
    workspace: {
      id: user.id,
      name: `${localPart}'s workspace`,
      slug: localPart,
      created_at: createdAt,
      updated_at: createdAt,
    },
    roles: ['member'],
  };

  return NextResponse.json(body);
}
