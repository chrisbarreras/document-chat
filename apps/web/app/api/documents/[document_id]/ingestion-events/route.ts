// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from 'next/server';
import type { components } from '@document-chat/contracts';
import { getOptionalUser } from '../../../../../lib/auth';
import { getDocumentRow } from '../../../../../lib/documents-store';
import {
  getEventsSince,
  listIngestionEvents,
  toContractIngestionEvent,
} from '../../../../../lib/ingestion-events-store';
import { problemResponse, unauthorized } from '../../../../../lib/problem';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../../../../../lib/documents';

type PaginatedIngestionEvents = components['schemas']['PaginatedIngestionEvents'];
type IngestionEvent = components['schemas']['IngestionEvent'];

type Params = { params: Promise<{ document_id: string }> };

/** Poll cadence for the SSE path. */
const POLL_INTERVAL_MS = 1000;
/** Hard cap on SSE lifetime so a wedged document can't keep a Vercel handler alive forever. */
const MAX_STREAM_MS = 5 * 60 * 1000;

function badRequest(detail: string): NextResponse {
  return problemResponse({ status: 400, code: 'request.invalid', title: 'Bad Request', detail });
}

function notFoundDocument(): NextResponse {
  return problemResponse({ status: 404, code: 'document.not_found', title: 'Not Found' });
}

/**
 * GET /documents/{id}/ingestion-events
 *
 * Content-negotiates on `Accept`:
 * - `text/event-stream` opens a polling SSE stream that closes when the
 *   document reaches `ready` or `failed` (or after MAX_STREAM_MS).
 * - Anything else returns a cursor-paginated JSON list of past events.
 */
export async function GET(request: Request, { params }: Params): Promise<Response> {
  const user = await getOptionalUser();
  if (!user) return unauthorized('Sign in to view ingestion events.');

  const { document_id } = await params;
  const document = await getDocumentRow(document_id);
  if (!document) return notFoundDocument();

  const accept = request.headers.get('accept') ?? '';
  if (accept.includes('text/event-stream')) {
    return streamResponse(document_id, document.ingestion_state);
  }

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
  const { items, nextCursor } = await listIngestionEvents({
    documentId: document_id,
    ...(cursor ? { cursor } : {}),
    limit,
  });

  const body: PaginatedIngestionEvents = {
    items: items.map(toContractIngestionEvent),
    page: { limit, next_cursor: nextCursor },
  };
  return NextResponse.json(body);
}

function frame(event: IngestionEvent, id: number): string {
  return `event: ${event.event}\nid: ${id}\ndata: ${JSON.stringify(event)}\n\n`;
}

function isTerminal(state: string | null | undefined): boolean {
  return state === 'ready' || state === 'failed';
}

/**
 * Build the SSE response. Polls `ingestion_events` on a fixed cadence,
 * emits each new row, and closes when the row reaches a terminal state.
 * Sends a heartbeat comment every poll to keep proxies from buffering.
 */
function streamResponse(documentId: string, initialState: string): Response {
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let id = 0;
      let afterTs: string | null = null;
      let afterId: string | null = null;
      let lastState = initialState;
      const startedAt = Date.now();

      const drain = async (): Promise<void> => {
        const rows = await getEventsSince(documentId, afterTs, afterId);
        for (const row of rows) {
          afterTs = row.occurred_at;
          afterId = row.id;
          if (row.to_state) lastState = row.to_state;
          controller.enqueue(encoder.encode(frame(toContractIngestionEvent(row), id++)));
        }
      };

      try {
        // Initial drain: catch the consumer up on any history they missed
        // between page load and stream open.
        await drain();
        if (isTerminal(lastState)) {
          controller.close();
          return;
        }

        while (!cancelled && Date.now() - startedAt < MAX_STREAM_MS) {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
          if (cancelled) break;
          // Heartbeat comment per SSE convention (lines starting with `:`);
          // keeps proxies from buffering the connection closed.
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
          await drain();
          if (isTerminal(lastState)) break;
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `event: error\nid: ${id}\ndata: ${JSON.stringify({
              message: err instanceof Error ? err.message : 'stream error',
            })}\n\n`,
          ),
        );
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
