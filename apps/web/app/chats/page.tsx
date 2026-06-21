// SPDX-License-Identifier: Apache-2.0
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOptionalUser } from '../../lib/auth';
import { getCurrentWorkspace } from '../../lib/workspace';
import { listChats } from '../../lib/chats-store';
import { DEFAULT_PAGE_LIMIT } from '../../lib/documents';
import { AppShell } from '../app-shell';
import { NewChatComposer } from './new-chat-composer';

export const dynamic = 'force-dynamic';

export default async function ChatsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const user = await getOptionalUser();
  if (!user) redirect('/login');

  const workspace = await getCurrentWorkspace();
  // RLS guarantees workspace presence for any signed-in user post-signup
  // trigger, but defend against the unconfigured-Supabase case gracefully.
  if (!workspace) {
    return (
      <AppShell user={user}>
        <div className="page-header">
          <div className="page-header__title">
            <h1>Chats</h1>
          </div>
        </div>
        <div className="empty-state">
          Workspace not provisioned yet. Try signing out and back in.
        </div>
      </AppShell>
    );
  }

  const { cursor } = await searchParams;
  const { items, nextCursor } = await listChats({
    workspaceId: workspace.id,
    limit: DEFAULT_PAGE_LIMIT,
    ...(cursor ? { cursor } : {}),
  });

  return (
    <AppShell user={user}>
      <div className="page-header">
        <div className="page-header__title">
          <h1>Chats</h1>
          <p>Ask questions across your documents and get cited answers.</p>
        </div>
      </div>

      <NewChatComposer />

      <section className="page-section">
        {items.length === 0 ? (
          <div className="empty-state">No chats yet. Ask a question to get started.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Last updated</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {items.map((chat) => (
                <tr key={chat.id}>
                  <td>
                    <Link href={`/chats/${chat.id}`}>{chat.title}</Link>
                  </td>
                  <td className="subtle">
                    {chat.last_message_at
                      ? new Date(chat.last_message_at).toLocaleString()
                      : '—'}
                  </td>
                  <td className="subtle">{new Date(chat.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {nextCursor ? (
        <p className="page-footer-links">
          <Link href={`/chats?cursor=${encodeURIComponent(nextCursor)}`}>Next page →</Link>
        </p>
      ) : null}
    </AppShell>
  );
}
