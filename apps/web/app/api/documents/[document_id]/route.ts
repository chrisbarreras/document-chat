// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from 'next/server';
import type { components } from '@document-chat/contracts';
import { getOptionalUser } from '../../../../lib/auth';
import {
  getDocumentRow,
  updateDocumentRow,
  deleteDocumentAndObject,
} from '../../../../lib/documents-store';
import { problemResponse, unauthorized } from '../../../../lib/problem';
import { DOCUMENT_STATUSES, toContractDocument, type DocumentRow } from '../../../../lib/documents';

type UpdateDocumentRequest = components['schemas']['UpdateDocumentRequest'];

type Params = { params: Promise<{ document_id: string }> };

function notFound(): NextResponse {
  return problemResponse({ status: 404, code: 'document.not_found', title: 'Not Found' });
}

function toDocument(row: DocumentRow) {
  return toContractDocument(row, { user_id: row.uploaded_by });
}

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const user = await getOptionalUser();
  if (!user) return unauthorized('Sign in to view this document.');

  const { document_id } = await params;
  const row = await getDocumentRow(document_id);
  if (!row) return notFound();
  return NextResponse.json(toDocument(row));
}

export async function PATCH(request: Request, { params }: Params): Promise<NextResponse> {
  const user = await getOptionalUser();
  if (!user) return unauthorized('Sign in to edit this document.');

  let body: UpdateDocumentRequest;
  try {
    body = (await request.json()) as UpdateDocumentRequest;
  } catch {
    return problemResponse({
      status: 400,
      code: 'request.invalid_json',
      title: 'Bad Request',
      detail: 'Request body must be valid JSON.',
    });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.title === 'string') patch.title = body.title;
  if (typeof body.version === 'string') patch.version = body.version;
  if (body.status !== undefined) {
    if (!(DOCUMENT_STATUSES as readonly string[]).includes(body.status)) {
      return problemResponse({
        status: 422,
        code: 'document.invalid_status',
        title: 'Unprocessable Entity',
        detail: `status must be one of: ${DOCUMENT_STATUSES.join(', ')}.`,
      });
    }
    patch.status = body.status;
  }
  if (body.effective_date !== undefined) {
    if (body.effective_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(body.effective_date)) {
      return problemResponse({
        status: 400,
        code: 'request.invalid',
        title: 'Bad Request',
        detail: 'effective_date must be a YYYY-MM-DD date or null.',
      });
    }
    patch.effective_date = body.effective_date;
  }

  if (Object.keys(patch).length === 0) {
    return problemResponse({
      status: 400,
      code: 'request.invalid',
      title: 'Bad Request',
      detail: 'Provide at least one field to update.',
    });
  }

  const { document_id } = await params;
  const row = await updateDocumentRow(document_id, patch);
  if (!row) return notFound();
  return NextResponse.json(toDocument(row));
}

export async function DELETE(_request: Request, { params }: Params): Promise<NextResponse> {
  const user = await getOptionalUser();
  if (!user) return unauthorized('Sign in to delete this document.');

  const { document_id } = await params;
  const deleted = await deleteDocumentAndObject(document_id);
  if (!deleted) return notFound();
  return new NextResponse(null, { status: 204 });
}
