// SPDX-License-Identifier: Apache-2.0
// Database I/O for chats, messages, citations. All reads + writes go through
// the cookie-bound (RLS-scoped) client; the streaming chunk (#15) will add
// service-role writes for the assistant turn (long-running, no session).
import { createSSRClient } from './supabase/server';
import { encodeCursor, decodeCursor } from './documents';
import type {
  ChatRow,
  MessageRow,
  MessageCitationRow,
  MessageRole,
} from './chats';

const CHAT_COLUMNS =
  'id, workspace_id, user_id, title, archived, last_message_at, created_at, updated_at';

const MESSAGE_COLUMNS =
  'id, chat_id, role, content, model, finish_reason, input_tokens, output_tokens, ' +
  'total_tokens, cost_usd_micros, error, as_of_date, retrieval_mode, created_at';

const CITATION_COLUMNS = 'id, message_id, chunk_id, document_id, index, score, created_at';

export interface ListChatsParams {
  workspaceId: string;
  archived?: boolean;
  cursor?: string;
  limit: number;
}

/**
 * List chats in the caller's workspace ordered by recent activity
 * (last_message_at, falling back to created_at). RLS scopes to the
 * caller; the explicit workspace filter is defense-in-depth.
 */
export async function listChats(
  params: ListChatsParams,
): Promise<{ items: ChatRow[]; nextCursor: string | null }> {
  const supabase = await createSSRClient();
  const offset = decodeCursor(params.cursor);

  let query = supabase
    .from('chats')
    .select(CHAT_COLUMNS)
    .eq('workspace_id', params.workspaceId);
  if (typeof params.archived === 'boolean') query = query.eq('archived', params.archived);

  const { data, error } = await query
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + params.limit);

  if (error || !data) return { items: [], nextCursor: null };

  const rows = data as unknown as ChatRow[];
  const hasMore = rows.length > params.limit;
  const items = hasMore ? rows.slice(0, params.limit) : rows;
  const nextCursor = hasMore ? encodeCursor(offset + params.limit) : null;
  return { items, nextCursor };
}

export interface NewChat {
  workspaceId: string;
  userId: string;
  title: string;
}

/** Insert a chat row (RLS-scoped). Null on failure. */
export async function insertChat(chat: NewChat): Promise<ChatRow | null> {
  const supabase = await createSSRClient();
  const { data, error } = await supabase
    .from('chats')
    .insert({
      workspace_id: chat.workspaceId,
      user_id: chat.userId,
      title: chat.title,
    })
    .select(CHAT_COLUMNS)
    .single();
  if (error || !data) return null;
  return data as unknown as ChatRow;
}

/** Fetch a single chat by id (RLS-scoped). Null if absent or RLS-hidden. */
export async function getChatRow(id: string): Promise<ChatRow | null> {
  const supabase = await createSSRClient();
  const { data, error } = await supabase
    .from('chats')
    .select(CHAT_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as ChatRow;
}

/** Apply a partial chat update (RLS-scoped). */
export async function updateChatRow(
  id: string,
  patch: Record<string, unknown>,
): Promise<ChatRow | null> {
  const supabase = await createSSRClient();
  const { data, error } = await supabase
    .from('chats')
    .update(patch)
    .eq('id', id)
    .select(CHAT_COLUMNS)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as ChatRow;
}

/** Delete a chat (RLS-scoped, cascades to messages + citations). */
export async function deleteChatRow(id: string): Promise<boolean> {
  const supabase = await createSSRClient();
  const { data, error } = await supabase
    .from('chats')
    .delete()
    .eq('id', id)
    .select('id');
  if (error || !data) return false;
  return data.length > 0;
}

export interface ListMessagesParams {
  chatId: string;
  cursor?: string;
  limit: number;
}

/**
 * List messages in a chat, oldest first (so a UI can append-render). Cursor
 * pagination mirrors chats/documents — opaque offset.
 */
export async function listChatMessages(
  params: ListMessagesParams,
): Promise<{ items: MessageRow[]; nextCursor: string | null }> {
  const supabase = await createSSRClient();
  const offset = decodeCursor(params.cursor);

  const { data, error } = await supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('chat_id', params.chatId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(offset, offset + params.limit);

  if (error || !data) return { items: [], nextCursor: null };

  const rows = data as unknown as MessageRow[];
  const hasMore = rows.length > params.limit;
  const items = hasMore ? rows.slice(0, params.limit) : rows;
  const nextCursor = hasMore ? encodeCursor(offset + params.limit) : null;
  return { items, nextCursor };
}

export interface NewMessage {
  chatId: string;
  role: MessageRole;
  content: string;
}

/** Insert a message (RLS-scoped). Null on failure. */
export async function insertMessage(msg: NewMessage): Promise<MessageRow | null> {
  const supabase = await createSSRClient();
  const { data, error } = await supabase
    .from('messages')
    .insert({
      chat_id: msg.chatId,
      role: msg.role,
      content: msg.content,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error || !data) return null;
  return data as unknown as MessageRow;
}

/** Fetch a single message by id (RLS-scoped). */
export async function getMessageRow(id: string): Promise<MessageRow | null> {
  const supabase = await createSSRClient();
  const { data, error } = await supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as MessageRow;
}

/** Fetch a message's citations, ordered by their emission index. */
export async function getMessageCitations(messageId: string): Promise<MessageCitationRow[]> {
  const supabase = await createSSRClient();
  const { data, error } = await supabase
    .from('citations')
    .select(CITATION_COLUMNS)
    .eq('message_id', messageId)
    .order('index', { ascending: true });
  if (error || !data) return [];
  return data as unknown as MessageCitationRow[];
}

/**
 * Batch-load citations for many messages in a single round-trip. Returns a
 * map keyed by `message_id` so the list-messages route can hydrate each row
 * without N+1 queries.
 */
export async function getCitationsForMessages(
  messageIds: string[],
): Promise<Map<string, MessageCitationRow[]>> {
  const empty = new Map<string, MessageCitationRow[]>();
  if (messageIds.length === 0) return empty;

  const supabase = await createSSRClient();
  const { data, error } = await supabase
    .from('citations')
    .select(CITATION_COLUMNS)
    .in('message_id', messageIds)
    .order('index', { ascending: true });
  if (error || !data) return empty;

  const out = new Map<string, MessageCitationRow[]>();
  for (const row of data as unknown as MessageCitationRow[]) {
    const arr = out.get(row.message_id) ?? [];
    arr.push(row);
    out.set(row.message_id, arr);
  }
  return out;
}
