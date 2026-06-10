// SPDX-License-Identifier: Apache-2.0
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOptionalUser } from '../../lib/auth';
import { getCurrentWorkspace } from '../../lib/workspace';
import { listChats } from '../../lib/chats-store';
import { DEFAULT_PAGE_LIMIT } from '../../lib/documents';
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
      <main>
        <h1>Chats</h1>
        <p>Workspace not provisioned yet. Try signing out and back in.</p>
      </main>
    );
  }

  const { cursor } = await searchParams;
  const { items, nextCursor } = await listChats({
    workspaceId: workspace.id,
    limit: DEFAULT_PAGE_LIMIT,
    ...(cursor ? { cursor } : {}),
  });

  return (
    <main>
      <h1>Chats</h1>

      <NewChatComposer />

      {items.length === 0 ? (
        <p>No chats yet. Ask a question to get started.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Last activity</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {items.map((chat) => (
              <tr key={chat.id}>
                <td>
                  <Link href={`/chats/${chat.id}`}>{chat.title}</Link>
                </td>
                <td>
                  {chat.last_message_at
                    ? new Date(chat.last_message_at).toLocaleString()
                    : '—'}
                </td>
                <td>{new Date(chat.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {nextCursor ? (
        <p>
          <Link href={`/chats?cursor=${encodeURIComponent(nextCursor)}`}>Next page</Link>
        </p>
      ) : null}

      <p>
        <Link href="/documents">Documents</Link> · <Link href="/">Home</Link>
      </p>
    </main>
  );
}
