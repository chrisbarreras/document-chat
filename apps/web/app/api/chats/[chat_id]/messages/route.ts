// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from 'next/server';
import type { components } from '@document-chat/contracts';
import { DEFAULT_CHAT_MODEL } from '@document-chat/retrieval';
import { getOptionalUser } from '../../../../../lib/auth';
import { getCurrentWorkspace } from '../../../../../lib/workspace';
import {
  getChatRow,
  getCitationsForMessages,
  insertMessage,
  listChatMessages,
  listRecentChatMessages,
} from '../../../../../lib/chats-store';
import {
  FEATURE_NOT_AVAILABLE_CODE,
  toContractMessage,
} from '../../../../../lib/chats';
import { stripCitationMarkers } from '../../../../../lib/chat/citations';
import type { MessageRow } from '../../../../../lib/chats';
import { problemResponse, unauthorized } from '../../../../../lib/problem';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../../../../../lib/documents';
import { checkTier1FeatureGuards } from '../../route';
import { runChatTurn } from '../../../../../lib/chat/orchestrate';
import { buildOrchestratorDeps } from '../../../../../lib/chat/runtime';
import { sseResponse } from '../../../../../lib/chat/sse';
import { createSSRClient } from '../../../../../lib/supabase/server';

type SendMessageRequest = components['schemas']['SendMessageRequest'];
type PaginatedMessages = components['schemas']['PaginatedMessages'];

type Params = { params: Promise<{ chat_id: string }> };

const MAX_CONTENT = 32000;
const DEFAULT_TOP_K = 8;
// Conversation-memory bounds: take at most this many prior turns, then trim the
// oldest until under the char budget so a long chat can't blow the context.
const HISTORY_MAX_MESSAGES = 30;
const HISTORY_CHAR_BUDGET = 16000;

/**
 * Turn stored message rows into the model's prior-turn history: drop the
 * just-sent message, strip citation markers from assistant turns, trim the
 * oldest to fit the budget, and ensure it starts with a `user` turn (the API
 * requires the first message to be `user`).
 */
function buildChatHistory(
  rows: MessageRow[],
  excludeId: string,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const turns = rows
    .filter((r) => r.id !== excludeId && (r.role === 'user' || r.role === 'assistant'))
    .map((r) => ({
      role: r.role as 'user' | 'assistant',
      content: r.role === 'assistant' ? stripCitationMarkers(r.content) : r.content,
    }));

  let total = turns.reduce((n, t) => n + t.content.length, 0);
  while (turns.length > 0 && total > HISTORY_CHAR_BUDGET) {
    total -= turns[0]!.content.length;
    turns.shift();
  }
  // After trimming we may now start mid-exchange on an assistant turn.
  while (turns.length > 0 && turns[0]!.role === 'assistant') turns.shift();
  return turns;
}

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

// POST /chats/{id}/messages — content-negotiated. JSON path persists the user
// message and returns it (no assistant turn); SSE path runs the full
// retrieve → stream → persist orchestration.
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const user = await getOptionalUser();
  if (!user) return unauthorized('Sign in to send messages.');

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

  if (typeof body?.content !== 'string') return badRequest('content must be a string.');
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

  // Always persist the user message first so a retry / reconnect can find it.
  const userMessage = await insertMessage({
    chatId: chat_id,
    role: 'user',
    content: body.content,
  });
  if (!userMessage) {
    return problemResponse({
      status: 500,
      code: 'message.create_failed',
      title: 'Could not create message',
    });
  }

  const accept = request.headers.get('accept') ?? '';
  if (!accept.includes('text/event-stream')) {
    // Non-streaming path: hand back the persisted user message. Clients
    // wanting the assistant turn negotiate via Accept.
    return NextResponse.json(toContractMessage(userMessage, []), { status: 200 });
  }

  // Streaming path — resolve workspace + Anthropic deps, then run the
  // orchestrator. Errors thrown inside the generator surface as an SSE
  // `error` frame, not a 5xx — the connection is already upgraded.
  if (!process.env.ANTHROPIC_API_KEY) {
    return problemResponse({
      status: 503,
      code: 'streaming.not_available',
      title: 'Streaming not available',
      detail: 'ANTHROPIC_API_KEY is not configured on this server.',
    });
  }
  const workspace = await getCurrentWorkspace();
  if (!workspace) {
    return problemResponse({
      status: 500,
      code: 'workspace.not_provisioned',
      title: 'Workspace not provisioned',
    });
  }

  // Conversation memory: load prior turns (excluding the message we just
  // inserted) so the model can answer follow-ups in context.
  const recent = await listRecentChatMessages(chat_id, HISTORY_MAX_MESSAGES);
  const history = buildChatHistory(recent, userMessage.id);

  const rlsClient = await createSSRClient();
  const deps = buildOrchestratorDeps(rlsClient, workspace.id);
  const events = runChatTurn(deps, {
    chatId: chat_id,
    userMessage: body.content,
    topK: typeof body.top_k === 'number' ? body.top_k : DEFAULT_TOP_K,
    model: typeof body.model === 'string' ? body.model : DEFAULT_CHAT_MODEL,
    history,
  });
  return sseResponse(events);
}
