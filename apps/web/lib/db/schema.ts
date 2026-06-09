// SPDX-License-Identifier: Apache-2.0
//
// Drizzle schema — the TypeScript source of truth for table shape and inferred
// row types. The authoritative DDL (and all RLS, triggers, grants) lives in
// supabase/migrations/ and is applied by `supabase db reset`; this file is kept
// in sync by hand. See docs/adr/0004-schema-migrations-and-drizzle.md.
import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  uniqueIndex,
  index,
  integer,
  bigint,
  date,
  vector,
  boolean,
  doublePrecision,
  jsonb,
} from 'drizzle-orm/pg-core';
import type { InferSelectModel } from 'drizzle-orm';

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // References auth.users(id) in SQL; the auth schema isn't modeled here.
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One workspace per user in Tier 1; slugs are globally unique.
    uniqueIndex('workspaces_owner_id_key').on(table.ownerId),
    uniqueIndex('workspaces_slug_key').on(table.slug),
  ],
);

export type Workspace = InferSelectModel<typeof workspaces>;

// Tier 1 document status (REQ-1.3.2). Tier 3 widens this enum.
export const documentStatus = pgEnum('document_status', ['draft', 'current', 'retired']);

// Ingestion pipeline state machine (REQ-1.1.2).
export const ingestionState = pgEnum('ingestion_state', [
  'pending',
  'extracting',
  'chunking',
  'embedding',
  'ready',
  'failed',
]);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    version: text('version').notNull().default('1.0'),
    status: documentStatus('status').notNull().default('current'),
    effectiveDate: date('effective_date'),
    ingestionState: ingestionState('ingestion_state').notNull().default('pending'),
    ingestionError: text('ingestion_error'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    pageCount: integer('page_count'),
    contentType: text('content_type').notNull(),
    storageObjectKey: text('storage_object_key').notNull(),
    embeddingModel: text('embedding_model').notNull(),
    // References auth.users(id) in SQL; the auth schema isn't modeled here.
    uploadedBy: uuid('uploaded_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('documents_workspace_id_idx').on(table.workspaceId)],
);

export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    index: integer('index').notNull(),
    text: text('text').notNull(),
    tokenCount: integer('token_count').notNull(),
    embeddingModel: text('embedding_model').notNull(),
    pageNumber: integer('page_number'),
    charStart: integer('char_start').notNull(),
    charEnd: integer('char_end').notNull(),
    sectionPath: text('section_path').array(),
    // 1536 dims = OpenAI text-embedding-3-small. The HNSW index and the
    // `extensions.vector` type are defined in the SQL migration (the opclass
    // lives in the extensions schema).
    embedding: vector('embedding', { dimensions: 1536 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('chunks_document_id_index_key').on(table.documentId, table.index),
    index('chunks_document_id_idx').on(table.documentId),
  ],
);

export type Document = InferSelectModel<typeof documents>;
export type Chunk = InferSelectModel<typeof chunks>;

// Tier 1 message role + finish reason. Tier 4 may add `tool` to role.
export const messageRole = pgEnum('message_role', ['user', 'assistant', 'system']);
export const messageFinishReason = pgEnum('message_finish_reason', [
  'stop',
  'length',
  'content_filter',
  'error',
]);

export const chats = pgTable(
  'chats',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // References auth.users(id) in SQL; the auth schema isn't modeled here.
    userId: uuid('user_id').notNull(),
    title: text('title').notNull(),
    archived: boolean('archived').notNull().default(false),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('chats_workspace_id_idx').on(table.workspaceId),
    index('chats_user_id_idx').on(table.userId),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    role: messageRole('role').notNull(),
    content: text('content').notNull(),
    model: text('model'),
    finishReason: messageFinishReason('finish_reason'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    totalTokens: integer('total_tokens'),
    costUsdMicros: integer('cost_usd_micros'),
    error: jsonb('error'),
    asOfDate: date('as_of_date'),
    retrievalMode: text('retrieval_mode'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('messages_chat_id_created_idx').on(table.chatId, table.createdAt, table.id)],
);

export const citations = pgTable(
  'citations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    // Soft references — see the SQL migration for the rationale (REQ-1.2.4).
    chunkId: uuid('chunk_id').notNull(),
    documentId: uuid('document_id').notNull(),
    index: integer('index').notNull(),
    score: doublePrecision('score'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('citations_message_id_index_key').on(table.messageId, table.index),
    index('citations_message_id_idx').on(table.messageId),
    index('citations_chunk_id_idx').on(table.chunkId),
  ],
);

export type Chat = InferSelectModel<typeof chats>;
export type Message = InferSelectModel<typeof messages>;
export type CitationRow = InferSelectModel<typeof citations>;
