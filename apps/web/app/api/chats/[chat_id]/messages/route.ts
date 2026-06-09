// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from 'next/server';
import type { components } from '@document-chat/contracts';
import { getOptionalUser } from '../../../../../lib/auth';
import {
  getChatRow,
  getCitationsForMessages,
  insertMessage,
  listChatMessages,
} from '../../../../../lib/chats-store';
import {
  FEATURE_NOT_AVAILABLE_CODE,
  toContractMessage,
} from '../../../../../lib/chats';
import { problemResponse, unauthorized } from '../../../../../lib/problem';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../../../../../lib/documents';
import { checkTier1FeatureGuards } from '../../route';

type SendMessageRequest = components['schemas']['SendMessageRequest'];
type PaginatedMessages = components['schemas']['PaginatedMessages'];

type Params = { params: Promise<{ chat_id: string }> };

const MAX_CONTENT = 32000;

function notFoundChat(): NextResponse {
  return problemResponse({ status: 404, code: 'chat.not_found', title: 'Not Found' });
}

function badRequest(detail: string): NextResponse {
  return problemResponse({ status: 400, code: 'request.invalid', title: 'Bad Request', detail });
}

function unprocessable(detail: string): NextResponse {
  return problemResponse({
    status: 422,
    code: FEATURE_NOT_AVAILABLE_CODE,
    title: 'Feature not available',
    detail,
  });
}

// GET /chats/{id}/messages — list messages, oldest first, with citations.
export async function GET(request: Request, { params }: Params): Promise<NextResponse> {
  const user = await getOptionalUser();
  if (!user) return unauthorized('Sign in to list messages.');

  const { chat_id } = await params;
  // Existence + RLS check before paging.
  const chat = await getChatRow(chat_id);
  if (!chat) return notFoundChat();

  const url = new URL(request.url);
  const qs = url.searchParams;

  let limit = DEFAULT_PAGE_LIMIT;
  const limitRaw = qs.get('limit');
  if (limitRaw !== null) {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_LIMIT) {
      return badRequest(`limit must be an integer between 1 and ${MAX_PAGE_LIMIT}.`);
    }
    limit = n;
  }

  const cursor = qs.get('cursor') ?? undefined;

  const { items, nextCursor } = await listChatMessages({
    chatId: chat_id,
    ...(cursor ? { cursor } : {}),
    limit,
  });

  // Batch-hydrate citations in a single round trip.
  const citationsByMessage = await getCitationsForMessages(items.map((m) => m.id));

  const body: PaginatedMessages = {
    items: items.map((m) => toContractMessage(m, citationsByMessage.get(m.id) ?? [])),
    page: { limit, next_cursor: nextCursor },
  };
  return NextResponse.json(body);
}

// POST /chats/{id}/messages — persist a user message. Streaming and assistant
// turns land in chunk #15; until then the JSON path returns the persisted
// user message and SSE is 503.
export async function POST(request: Request, { params }: Params): Promise<NextResponse> {
  const user = await getOptionalUser();
  if (!user) return unauthorized('Sign in to send messages.');

  const accept = request.headers.get('accept') ?? '';
  if (accept.includes('text/event-stream')) {
    return problemResponse({
      status: 503,
      code: 'streaming.not_available',
      title: 'Streaming not available',
      detail: 'SSE streaming for chat replies lands in a later release.',
    });
  }

  const { chat_id } = await params;
  const chat = await getChatRow(chat_id);
  if (!chat) return notFoundChat();

  let body: SendMessageRequest;
  try {
    body = (await request.json()) as SendMessageRequest;
  } catch {
    return problemResponse({
      status: 400,
      code: 'request.invalid_json',
      title: 'Bad Request',
      detail: 'Request body must be valid JSON.',
    });
  }

  if (typeof body?.content !== 'string') {
    return badRequest('content must be a string.');
  }
  const trimmed = body.content.trim();
  if (trimmed.length === 0) return badRequest('content must be a non-empty string.');
  if (body.content.length > MAX_CONTENT) {
    return problemResponse({
      status: 422,
      code: 'message.content_too_long',
      title: 'Unprocessable Entity',
      detail: `content must be ${MAX_CONTENT} characters or fewer.`,
    });
  }
  const feature = checkTier1FeatureGuards(body);
  if (feature) return unprocessable(feature);

  const message = await insertMessage({
    chatId: chat_id,
    role: 'user',
    content: body.content,
  });
  if (!message) {
    return problemResponse({
      status: 500,
      code: 'message.create_failed',
      title: 'Could not create message',
    });
  }

  return NextResponse.json(toContractMessage(message, []), { status: 200 });
}
