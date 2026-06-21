// SPDX-License-Identifier: Apache-2.0
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOptionalUser } from '../../lib/auth';
import { listDocuments } from '../../lib/documents-store';
import { DEFAULT_PAGE_LIMIT } from '../../lib/documents';
import { AppShell } from '../app-shell';
import { UploadForm } from './upload-form';
import { IngestionBadge } from './ingestion-badge';

export const dynamic = 'force-dynamic';

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const user = await getOptionalUser();
  if (!user) redirect('/login');

  const { cursor } = await searchParams;
  const { items, nextCursor } = await listDocuments({
    sort: 'uploaded_at',
    ascending: false,
    limit: DEFAULT_PAGE_LIMIT,
    ...(cursor ? { cursor } : {}),
  });

  return (
    <AppShell user={user}>
      <div className="page-header">
        <div className="page-header__title">
          <h1>Documents</h1>
          <p>Upload PDFs and watch them flow through extraction, chunking, and embedding.</p>
        </div>
      </div>

      <UploadForm />

      <section className="page-section">
        {items.length === 0 ? (
          <div className="empty-state">No documents yet. Upload a PDF to get started.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Processing</th>
                <th>Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {items.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <Link href={`/documents/${doc.id}`}>{doc.title}</Link>
                  </td>
                  <td>
                    <span className={`badge badge--${doc.status}`}>{doc.status}</span>
                  </td>
                  <td>
                    <IngestionBadge documentId={doc.id} initialState={doc.ingestion_state} />
                  </td>
                  <td className="subtle">{new Date(doc.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {nextCursor ? (
        <p className="page-footer-links">
          <Link href={`/documents?cursor=${encodeURIComponent(nextCursor)}`}>Next page →</Link>
        </p>
      ) : null}
    </AppShell>
  );
}
