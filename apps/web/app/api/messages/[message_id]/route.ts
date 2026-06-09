// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from 'next/server';
import { getOptionalUser } from '../../../../lib/auth';
import {
  getMessageCitations,
  getMessageRow,
} from '../../../../lib/chats-store';
import { toContractMessage } from '../../../../lib/chats';
import { problemResponse, unauthorized } from '../../../../lib/problem';

type Params = { params: Promise<{ message_id: string }> };

// GET /messages/{id} — retrieve a single message with its citations.
export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const user = await getOptionalUser();
  if (!user) return unauthorized('Sign in to view messages.');

  const { message_id } = await params;
  const row = await getMessageRow(message_id);
  if (!row) {
    return problemResponse({ status: 404, code: 'message.not_found', title: 'Not Found' });
  }

  const citations = await getMessageCitations(message_id);
  return NextResponse.json(toContractMessage(row, citations));
}
