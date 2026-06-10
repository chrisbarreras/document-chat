// SPDX-License-Identifier: Apache-2.0
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getOptionalUser } from '../../../lib/auth';
import { getDocumentRow } from '../../../lib/documents-store';
import { DocumentEditor } from './editor';
import { IngestionPanel } from './ingestion-panel';

export const dynamic = 'force-dynamic';

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ document_id: string }>;
}) {
  const user = await getOptionalUser();
  if (!user) redirect('/login');

  const { document_id } = await params;
  const doc = await getDocumentRow(document_id);
  if (!doc) notFound();

  return (
    <main>
      <h1>{doc.title}</h1>

      <dl>
        <dt>Status</dt>
        <dd>{doc.status}</dd>
        <dt>Version</dt>
        <dd>{doc.version}</dd>
        <dt>Effective date</dt>
        <dd>{doc.effective_date ?? '—'}</dd>
        <dt>Size</dt>
        <dd>{doc.size_bytes.toLocaleString()} bytes</dd>
        <dt>Type</dt>
        <dd>{doc.content_type}</dd>
        <dt>Uploaded</dt>
        <dd>{new Date(doc.created_at).toLocaleString()}</dd>
      </dl>

      <IngestionPanel
        documentId={doc.id}
        initialState={doc.ingestion_state}
        initialError={doc.ingestion_error}
      />

      <DocumentEditor
        doc={{
          id: doc.id,
          title: doc.title,
          version: doc.version,
          status: doc.status,
          effective_date: doc.effective_date,
        }}
      />

      <p>
        <Link href="/documents">Back to documents</Link>
      </p>
    </main>
  );
}
