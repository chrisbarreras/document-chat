// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, toContractDocument, type DocumentRow } from './documents';

describe('cursor encode/decode', () => {
  it('round-trips an offset', () => {
    expect(decodeCursor(encodeCursor(42))).toBe(42);
    expect(decodeCursor(encodeCursor(0))).toBe(0);
  });

  it('treats a missing cursor as offset 0', () => {
    expect(decodeCursor(null)).toBe(0);
    expect(decodeCursor(undefined)).toBe(0);
    expect(decodeCursor('')).toBe(0);
  });

  it('falls back to 0 for an undecodable cursor', () => {
    expect(decodeCursor('!!!not-base64!!!')).toBe(0);
  });

  it('rejects a negative offset', () => {
    const cursor = Buffer.from(JSON.stringify({ o: -5 })).toString('base64url');
    expect(decodeCursor(cursor)).toBe(0);
  });

  it('rejects a non-numeric offset', () => {
    const cursor = Buffer.from(JSON.stringify({ o: 'nope' })).toString('base64url');
    expect(decodeCursor(cursor)).toBe(0);
  });
});

const row: DocumentRow = {
  id: '22222222-2222-2222-2222-222222222222',
  workspace_id: '00000000-0000-0000-0000-0000000000aa',
  title: 'Quarterly report',
  version: '1.0',
  status: 'current',
  effective_date: null,
  ingestion_state: 'ready',
  ingestion_error: null,
  size_bytes: 1024,
  page_count: 12,
  content_type: 'application/pdf',
  storage_object_key: 'ws/obj.pdf',
  embedding_model: 'text-embedding-3-small',
  uploaded_by: '00000000-0000-0000-0000-000000000001',
  created_at: '2026-05-23T00:00:00.000Z',
  updated_at: '2026-05-23T00:00:00.000Z',
};

describe('toContractDocument', () => {
  it('maps row fields and includes the uploader email when present', () => {
    const doc = toContractDocument(row, { user_id: row.uploaded_by, email: 'ada@example.com' });
    expect(doc.id).toBe(row.id);
    expect(doc.title).toBe(row.title);
    expect(doc.page_count).toBe(12);
    expect(doc.uploaded_by).toEqual({ user_id: row.uploaded_by, email: 'ada@example.com' });
  });

  it('omits the email key when the uploader has none', () => {
    const doc = toContractDocument(row, { user_id: row.uploaded_by });
    expect(doc.uploaded_by).toEqual({ user_id: row.uploaded_by });
    expect('email' in doc.uploaded_by).toBe(false);
  });
});
