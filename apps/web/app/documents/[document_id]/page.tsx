// SPDX-License-Identifier: Apache-2.0
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getOptionalUser } from '../../../lib/auth';
import { getDocumentRow } from '../../../lib/documents-store';
import { AppShell } from '../../app-shell';
import { DocumentEditor } from './editor';
import { IngestionPanel } from './ingestion-panel';
import { IngestionBadge } from '../ingestion-badge';

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
    <AppShell user={user}>
      <div className="page-header">
        <div className="page-header__title">
          <h1>{doc.title}</h1>
          <p>
            <span className={`badge badge--${doc.status}`}>{doc.status}</span>{' '}
            <IngestionBadge documentId={doc.id} initialState={doc.ingestion_state} />
          </p>
        </div>
        <div className="page-header__actions">
          <a href={`/api/documents/${doc.id}/download`} className="btn btn--secondary btn--sm">
            Download PDF
          </a>
          <Link href="/documents" className="btn btn--ghost btn--sm">
            ← Back to documents
          </Link>
        </div>
      </div>

      <section className="card">
        <h2 className="card__title">Details</h2>
        <dl className="kv">
          <dt>Version</dt>
          <dd>{doc.version}</dd>
          <dt>Effective date</dt>
          <dd>{doc.effective_date ?? '—'}</dd>
          <dt>Size</dt>
          <dd>{doc.size_bytes.toLocaleString()} bytes</dd>
          <dt>Type</dt>
          <dd>
            <code>{doc.content_type}</code>
          </dd>
          <dt>Uploaded</dt>
          <dd>{new Date(doc.created_at).toLocaleString()}</dd>
        </dl>
      </section>

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
    </AppShell>
  );
}
