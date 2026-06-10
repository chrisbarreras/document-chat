// SPDX-License-Identifier: Apache-2.0
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOptionalUser } from '../../lib/auth';
import { listDocuments } from '../../lib/documents-store';
import { DEFAULT_PAGE_LIMIT } from '../../lib/documents';
import { UploadForm } from './upload-form';

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
    <main>
      <h1>Documents</h1>

      <UploadForm />

      {items.length === 0 ? (
        <p>No documents yet. Upload a PDF to get started.</p>
      ) : (
        <table>
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
                <td>{doc.status}</td>
                <td>{doc.ingestion_state}</td>
                <td>{new Date(doc.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {nextCursor ? (
        <p>
          <Link href={`/documents?cursor=${encodeURIComponent(nextCursor)}`}>Next page</Link>
        </p>
      ) : null}

      <p>
        <Link href="/chats">Chats</Link> · <Link href="/">Home</Link>
      </p>
    </main>
  );
}
