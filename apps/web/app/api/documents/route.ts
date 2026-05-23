// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from 'next/server';
import type { components } from '@document-chat/contracts';
import { getOptionalUser } from '../../../lib/auth';
import { getCurrentWorkspace } from '../../../lib/workspace';
import { findUploadedObject, insertDocument, listDocuments } from '../../../lib/documents-store';
import { problemResponse, unauthorized } from '../../../lib/problem';
import {
  ALLOWED_CONTENT_TYPES,
  MAX_UPLOAD_BYTES,
  toContractDocument,
  DOCUMENT_SORT_COLUMNS,
  DEFAULT_DOCUMENT_SORT,
  DOCUMENT_STATUSES,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  type DocumentSort,
} from '../../../lib/documents';

type CreateDocumentRequest = components['schemas']['CreateDocumentRequest'];
type PaginatedDocuments = components['schemas']['PaginatedDocuments'];

function isAllowedType(t: string): boolean {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(t);
}

function badRequest(detail: string): NextResponse {
  return problemResponse({ status: 400, code: 'request.invalid', title: 'Bad Request', detail });
}

// GET /documents — list the caller's documents with filter / sort / cursor.
export async function GET(request: Request): Promise<NextResponse> {
  const user = await getOptionalUser();
  if (!user) return unauthorized('Sign in to list documents.');

  const workspace = await getCurrentWorkspace();
  if (!workspace) {
    return problemResponse({
      status: 500,
      code: 'workspace.not_provisioned',
      title: 'Workspace not provisioned',
    });
  }

  const params = new URL(request.url).searchParams;

  const status = params.get('status') ?? undefined;
  if (status && !(DOCUMENT_STATUSES as readonly string[]).includes(status)) {
    return badRequest(`status must be one of: ${DOCUMENT_STATUSES.join(', ')}.`);
  }

  const sort = params.get('sort') ?? DEFAULT_DOCUMENT_SORT;
  if (!(sort in DOCUMENT_SORT_COLUMNS)) {
    return badRequest(`sort must be one of: ${Object.keys(DOCUMENT_SORT_COLUMNS).join(', ')}.`);
  }

  const order = params.get('order') ?? 'desc';
  if (order !== 'asc' && order !== 'desc') {
    return badRequest('order must be "asc" or "desc".');
  }

  let limit = DEFAULT_PAGE_LIMIT;
  const limitRaw = params.get('limit');
  if (limitRaw !== null) {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_LIMIT) {
      return badRequest(`limit must be an integer between 1 and ${MAX_PAGE_LIMIT}.`);
    }
    limit = n;
  }

  const q = params.get('q') ?? undefined;
  const cursor = params.get('cursor') ?? undefined;

  const { items, nextCursor } = await listDocuments({
    ...(status ? { status } : {}),
    ...(q ? { q } : {}),
    sort: sort as DocumentSort,
    ascending: order === 'asc',
    ...(cursor ? { cursor } : {}),
    limit,
  });

  const body: PaginatedDocuments = {
    items: items.map((row) => toContractDocument(row, { user_id: row.uploaded_by })),
    page: { limit, next_cursor: nextCursor },
  };
  return NextResponse.json(body);
}

// POST /documents — finalize an upload: verify the staged object, then create
// the document row in `pending`. (Ingestion is enqueued in a later chunk.)
export async function POST(request: Request): Promise<NextResponse> {
  const user = await getOptionalUser();
  if (!user) return unauthorized('Sign in to create a document.');

  const workspace = await getCurrentWorkspace();
  if (!workspace) {
    return problemResponse({
      status: 500,
      code: 'workspace.not_provisioned',
      title: 'Workspace not provisioned',
    });
  }

  let body: CreateDocumentRequest;
  try {
    body = (await request.json()) as CreateDocumentRequest;
  } catch {
    return problemResponse({
      status: 400,
      code: 'request.invalid_json',
      title: 'Bad Request',
      detail: 'Request body must be valid JSON.',
    });
  }

  if (!body?.upload_id || !body.title) {
    return problemResponse({
      status: 400,
      code: 'request.invalid',
      title: 'Bad Request',
      detail: 'upload_id and title are required.',
    });
  }

  const objectName = `${body.upload_id}.pdf`;
  const object = await findUploadedObject(workspace.id, objectName);
  if (!object) {
    return problemResponse({
      status: 422,
      code: 'document.upload_incomplete',
      title: 'Upload not found',
      detail: 'No uploaded file was found for this upload_id. Upload the file before finalizing.',
    });
  }
  if (object.size > MAX_UPLOAD_BYTES) {
    return problemResponse({
      status: 413,
      code: 'document.too_large',
      title: 'Payload Too Large',
      detail: `Files must be ${MAX_UPLOAD_BYTES} bytes or smaller.`,
    });
  }
  if (object.mimetype && !isAllowedType(object.mimetype)) {
    return problemResponse({
      status: 415,
      code: 'document.unsupported_type',
      title: 'Unsupported Media Type',
      detail: 'Only application/pdf is accepted in Tier 1.',
    });
  }

  const row = await insertDocument({
    workspaceId: workspace.id,
    title: body.title,
    version: body.version ?? '1.0',
    status: body.status ?? 'current',
    effectiveDate: body.effective_date ?? null,
    sizeBytes: object.size,
    contentType: 'application/pdf',
    storageObjectKey: `${workspace.id}/${objectName}`,
    uploadedBy: user.id,
  });
  if (!row) {
    return problemResponse({
      status: 500,
      code: 'document.create_failed',
      title: 'Could not create document',
    });
  }

  const document = toContractDocument(row, {
    user_id: user.id,
    ...(user.email ? { email: user.email } : {}),
  });
  return NextResponse.json(document, { status: 201 });
}
