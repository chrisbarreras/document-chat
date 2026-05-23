// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from 'next/server';
import type { components } from '@document-chat/contracts';

type Problem = components['schemas']['Problem'];

export interface ProblemInit {
  status: number;
  /** Machine-readable code, e.g. `auth.unauthorized`. */
  code: string;
  /** Short human-readable title. */
  title: string;
  /** Longer human-readable explanation. */
  detail?: string;
}

/**
 * Build an RFC 9457 `application/problem+json` error response matching the
 * `Problem` schema in the OpenAPI contract. Every error carries a generated
 * `request_id` for correlation (NF-OBS.1).
 */
export function problemResponse({ status, code, title, detail }: ProblemInit): NextResponse {
  const body: Problem = {
    type: `https://docs.knowledge-graph.dev/errors/${code.replace(/\./g, '-')}`,
    title,
    status,
    code,
    request_id: crypto.randomUUID(),
    ...(detail !== undefined ? { detail } : {}),
  };
  return NextResponse.json(body, {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

/** 401 — missing or invalid session. */
export function unauthorized(detail?: string): NextResponse {
  return problemResponse({
    status: 401,
    code: 'auth.unauthorized',
    title: 'Unauthorized',
    ...(detail !== undefined ? { detail } : {}),
  });
}
