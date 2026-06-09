// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from 'next/server';
import type { components } from '@document-chat/contracts';
import { getOptionalUser } from '../../../../lib/auth';
import {
  deleteChatRow,
  getChatRow,
  updateChatRow,
} from '../../../../lib/chats-store';
import { toContractChat } from '../../../../lib/chats';
import { problemResponse, unauthorized } from '../../../../lib/problem';

type UpdateChatRequest = components['schemas']['UpdateChatRequest'];

type Params = { params: Promise<{ chat_id: string }> };

const MAX_TITLE = 200;

function notFound(): NextResponse {
  return problemResponse({ status: 404, code: 'chat.not_found', title: 'Not Found' });
}

// GET /chats/{id}
export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const user = await getOptionalUser();
  if (!user) return unauthorized('Sign in to view chats.');

  const { chat_id } = await params;
  const row = await getChatRow(chat_id);
  if (!row) return notFound();
  return NextResponse.json(toContractChat(row));
}

// PATCH /chats/{id} — rename or archive.
export async function PATCH(request: Request, { params }: Params): Promise<NextResponse> {
  const user = await getOptionalUser();
  if (!user) return unauthorized('Sign in to edit this chat.');

  let body: UpdateChatRequest;
  try {
    body = (await request.json()) as UpdateChatRequest;
  } catch {
    return problemResponse({
      status: 400,
      code: 'request.invalid_json',
      title: 'Bad Request',
      detail: 'Request body must be valid JSON.',
    });
  }

  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      return problemResponse({
        status: 400,
        code: 'request.invalid',
        title: 'Bad Request',
        detail: 'title must be a non-empty string.',
      });
    }
    if (body.title.length > MAX_TITLE) {
      return problemResponse({
        status: 422,
        code: 'chat.title_too_long',
        title: 'Unprocessable Entity',
        detail: `title must be ${MAX_TITLE} characters or fewer.`,
      });
    }
    patch.title = body.title.trim();
  }
  if (body.archived !== undefined) {
    if (typeof body.archived !== 'boolean') {
      return problemResponse({
        status: 400,
        code: 'request.invalid',
        title: 'Bad Request',
        detail: 'archived must be a boolean.',
      });
    }
    patch.archived = body.archived;
  }

  if (Object.keys(patch).length === 0) {
    return problemResponse({
      status: 400,
      code: 'request.invalid',
      title: 'Bad Request',
      detail: 'Provide at least one field to update.',
    });
  }

  const { chat_id } = await params;
  const row = await updateChatRow(chat_id, patch);
  if (!row) return notFound();
  return NextResponse.json(toContractChat(row));
}

// DELETE /chats/{id} — cascades messages + citations.
export async function DELETE(_request: Request, { params }: Params): Promise<NextResponse> {
  const user = await getOptionalUser();
  if (!user) return unauthorized('Sign in to delete this chat.');

  const { chat_id } = await params;
  const deleted = await deleteChatRow(chat_id);
  if (!deleted) return notFound();
  return new NextResponse(null, { status: 204 });
}
