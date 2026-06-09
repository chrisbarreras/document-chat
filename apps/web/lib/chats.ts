// SPDX-License-Identifier: Apache-2.0
// Pure constants + contract mappers for chats + messages. No I/O — DB
// access lives in chats-store.ts. Mirrors the documents.ts /
// documents-store.ts split so route unit tests can import this file
// without mocking the database.
import type { components } from '@document-chat/contracts';

type Chat = components['schemas']['Chat'];
type Message = components['schemas']['Message'];
type Citation = components['schemas']['Citation'];

// REQ-1.4.2 default top-k. The OpenAPI default matches.
export const DEFAULT_TOP_K = 8;
export const MAX_TOP_K = 50;

// Tier 1 servers reject `as_of_date` (Tier 3) and `retrieval.mode` (Tier 4)
// per the OpenAPI description on sendMessage / Message.
export const FEATURE_NOT_AVAILABLE_CODE = 'feature.not_available';

export const MESSAGE_ROLES = ['user', 'assistant', 'system'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const MESSAGE_FINISH_REASONS = [
  'stop',
  'length',
  'content_filter',
  'error',
] as const;
export type MessageFinishReason = (typeof MESSAGE_FINISH_REASONS)[number];

/** A `chats` row as selected from Postgres. */
export interface ChatRow {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string;
  archived: boolean;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A `messages` row as selected from Postgres. */
export interface MessageRow {
  id: string;
  chat_id: string;
  role: MessageRole;
  content: string;
  model: string | null;
  finish_reason: MessageFinishReason | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cost_usd_micros: number | null;
  error: unknown;
  as_of_date: string | null;
  retrieval_mode: string | null;
  created_at: string;
}

/** A `citations` row as selected from Postgres. */
export interface MessageCitationRow {
  id: string;
  message_id: string;
  chunk_id: string;
  document_id: string;
  index: number;
  score: number | null;
  created_at: string;
}

/** Map a DB row to the OpenAPI `Chat`. */
export function toContractChat(row: ChatRow): Chat {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    user_id: row.user_id,
    title: row.title,
    archived: row.archived,
    last_message_at: row.last_message_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Build a Citation stub from the persisted citation row alone. Used at
 * Message-render time before the route handler hydrates each citation via
 * the chunks/documents tables — keeps the Message shape consistent for the
 * non-hydrated path (e.g. an immediate POST response that doesn't fan out
 * to load each chunk's text). The streaming chunk (#15) replaces these
 * with hydrated citations via the chat-events `citation` event.
 */
export function toCitationStub(row: MessageCitationRow): Citation {
  return {
    id: row.id,
    chunk_id: row.chunk_id,
    document_id: row.document_id,
    document_title: '',
    document_version: '',
    page_number: null,
    excerpt: '',
    ...(row.score !== null ? { score: row.score } : {}),
    unavailable: false,
    unavailable_reason: null,
  };
}

/**
 * Map a DB row + its citation rows to the OpenAPI `Message`. Optional
 * `usage` and `finish_reason` are only emitted when present so the JSON
 * stays clean for user messages (which never carry them at Tier 1).
 */
export function toContractMessage(row: MessageRow, citations: MessageCitationRow[]): Message {
  const message: Message = {
    id: row.id,
    chat_id: row.chat_id,
    role: row.role,
    content: row.content,
    citations: citations.map(toCitationStub),
    created_at: row.created_at,
    ...(row.as_of_date !== null ? { as_of_date: row.as_of_date } : {}),
  };

  if (row.retrieval_mode !== null) {
    message.retrieval_mode = row.retrieval_mode as 'vector' | 'hybrid' | 'graph_only';
  }
  if (row.model) message.model = row.model;
  if (row.finish_reason) message.finish_reason = row.finish_reason;
  if (row.error) {
    // DB stores the Problem JSON verbatim; non-null when the message ended
    // in error. Cast to the contract's discriminated union after the guard.
    message.error = row.error as NonNullable<Message['error']>;
  }

  if (
    row.input_tokens !== null ||
    row.output_tokens !== null ||
    row.total_tokens !== null ||
    row.cost_usd_micros !== null
  ) {
    message.usage = {
      ...(row.input_tokens !== null ? { input_tokens: row.input_tokens } : {}),
      ...(row.output_tokens !== null ? { output_tokens: row.output_tokens } : {}),
      ...(row.total_tokens !== null ? { total_tokens: row.total_tokens } : {}),
      ...(row.cost_usd_micros !== null ? { cost_usd_micros: row.cost_usd_micros } : {}),
    };
  }

  return message;
}

/**
 * Build a default chat title from the user's first message. The streaming
 * chunk may replace this with an LLM-summarized title; for Tier 1 chunk #14
 * a clipped first-message snippet is enough to disambiguate the chat list.
 */
export function defaultChatTitle(firstMessage?: string): string {
  if (!firstMessage) return 'New chat';
  const trimmed = firstMessage.trim();
  if (trimmed.length === 0) return 'New chat';
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
}
