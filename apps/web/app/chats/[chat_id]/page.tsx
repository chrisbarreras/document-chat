// SPDX-License-Identifier: Apache-2.0
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getOptionalUser } from '../../../lib/auth';
import {
  getCitationsForMessages,
  getChatRow,
  listChatMessages,
} from '../../../lib/chats-store';
import { toContractMessage } from '../../../lib/chats';
import { AppShell } from '../../app-shell';
import { ChatClient } from './chat-client';

export const dynamic = 'force-dynamic';

const HISTORY_LIMIT = 50;

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ chat_id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await getOptionalUser();
  if (!user) redirect('/login');

  const { chat_id } = await params;
  const chat = await getChatRow(chat_id);
  if (!chat) notFound();

  // Pre-load history server-side so the page renders complete on first paint.
  // Streaming additions get layered on by the client.
  const { items: messageRows } = await listChatMessages({
    chatId: chat_id,
    limit: HISTORY_LIMIT,
  });
  const citationsByMessage = await getCitationsForMessages(messageRows.map((m) => m.id));
  const initialMessages = messageRows.map((m) =>
    toContractMessage(m, citationsByMessage.get(m.id) ?? []),
  );

  const { q } = await searchParams;

  return (
    <AppShell user={user}>
      <div className="page-header">
        <div className="page-header__title">
          <h1>{chat.title}</h1>
          <p className="subtle">
            Created {new Date(chat.created_at).toLocaleString()}
            {chat.last_message_at
              ? ` · Last updated ${new Date(chat.last_message_at).toLocaleString()}`
              : ''}
          </p>
        </div>
        <Link href="/chats" className="btn btn--ghost btn--sm">
          ← All chats
        </Link>
      </div>

      <ChatClient
        chatId={chat_id}
        initialMessages={initialMessages}
        autoSendContent={q ?? null}
      />
    </AppShell>
  );
}
