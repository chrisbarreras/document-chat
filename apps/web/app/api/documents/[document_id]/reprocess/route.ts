// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from 'next/server';
import { getOptionalUser } from '../../../../../lib/auth';
import { getDocumentRow } from '../../../../../lib/documents-store';
import { problemResponse, unauthorized } from '../../../../../lib/problem';
import { toContractDocument, type DocumentRow } from '../../../../../lib/documents';
import { sendDocumentUploaded } from '../../../../../lib/inngest/client';
import { recordIngestionTransition } from '../../../../../lib/inngest/storage';

type Params = { params: Promise<{ document_id: string }> };

function toDocument(row: DocumentRow) {
  return toContractDocument(row, { user_id: row.uploaded_by });
}

/**
 * POST /api/documents/{id}:reprocess
 *
 * Resets the ingestion state machine to `pending`, clears any prior
 * ingestion_error, appends a `state_changed` row to ingestion_events, then
 * re-emits the `document.uploaded` event. The existing Inngest function
 * picks it up and walks the pipeline again. Stale chunks are cleaned up by
 * `replaceDocumentChunks` inside the embed step (delete-then-insert), so
 * we don't have to truncate them here.
 *
 * Rewritten from `/api/documents/{id}:reprocess` in next.config.mjs (the
 * colon path isn't a valid Windows folder name; same pattern as
 * citations:resolve).
 */
export async function POST(_request: Request, { params }: Params): Promise<NextResponse> {
  const user = await getOptionalUser();
  if (!user) return unauthorized('Sign in to reprocess documents.');

  const { document_id } = await params;
  const row = await getDocumentRow(document_id);
  if (!row) {
    return problemResponse({ status: 404, code: 'document.not_found', title: 'Not Found' });
  }

  try {
    await recordIngestionTransition(document_id, 'pending', { ingestionError: null });
  } catch (err) {
    return problemResponse({
      status: 500,
      code: 'document.reprocess_failed',
      title: 'Could not reset ingestion state',
      ...(err instanceof Error ? { detail: err.message } : {}),
    });
  }

  // Best-effort event emit. If Inngest is unreachable we still return 202 so
  // the user can click the button again — the row stays in `pending` and a
  // future reprocess will recover.
  try {
    await sendDocumentUploaded({
      document_id: row.id,
      workspace_id: row.workspace_id,
      storage_object_key: row.storage_object_key,
    });
  } catch (err) {
    console.error('reprocess: inngest send failed for document', row.id, err);
  }

  // Return the resource with the freshly-reset state by re-reading once.
  const reset = await getDocumentRow(document_id);
  return NextResponse.json(toDocument(reset ?? row), { status: 202 });
}
