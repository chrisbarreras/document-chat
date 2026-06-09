-- Chats, messages, and citations. Tier 1 subset of the OpenAPI Chat /
-- Message / Citation schemas. RLS scopes every row to the chat's workspace
-- (which the workspaces_select_own policy already binds to the auth user).

create type public.message_role as enum ('user', 'assistant', 'system');

create type public.message_finish_reason as enum (
  'stop', 'length', 'content_filter', 'error'
);

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  archived boolean not null default false,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chats_workspace_id_idx on public.chats (workspace_id);
create index chats_user_id_idx on public.chats (user_id);
-- Newest-first list paging keys on last_message_at (falling back to created_at).
create index chats_last_activity_idx on public.chats
  (workspace_id, coalesce(last_message_at, created_at) desc, id desc);

create trigger chats_set_updated_at
  before update on public.chats
  for each row execute function public.set_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  role public.message_role not null,
  content text not null,
  model text,
  finish_reason public.message_finish_reason,
  -- Token + cost metering — written by the streaming chunk (#15). All-null
  -- on the user messages persisted by the JSON POST path.
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  cost_usd_micros integer,
  -- The Problem JSON when the message terminates in error (REQ-1.5.4 et al).
  error jsonb,
  -- Tier 1 servers reject non-null at the API boundary; columns exist so
  -- the row shape is forward-compatible without a migration in chunk #17/#18.
  as_of_date date,
  retrieval_mode text,
  created_at timestamptz not null default now()
);

create index messages_chat_id_created_idx on public.messages (chat_id, created_at, id);

create table public.citations (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  -- Soft reference: when the underlying chunk is deleted (REQ-1.2.4 graceful
  -- degrade) the citation row stays so historical messages can still render
  -- an "unavailable" stub at /citations:resolve time.
  chunk_id uuid not null,
  document_id uuid not null,
  -- Ordinal within the message so the UI can render citations in the order
  -- the LLM emitted them; unique within a message.
  index integer not null,
  score double precision,
  created_at timestamptz not null default now(),
  unique (message_id, index)
);

create index citations_message_id_idx on public.citations (message_id);
create index citations_chunk_id_idx on public.citations (chunk_id);

alter table public.chats enable row level security;
alter table public.messages enable row level security;
alter table public.citations enable row level security;

-- Chats: full access to chats in a workspace the caller owns.
create policy chats_rw_own on public.chats
  for all to authenticated
  using (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.owner_id = auth.uid()
    )
  );

-- Messages: inherit access from their parent chat.
create policy messages_rw_own on public.messages
  for all to authenticated
  using (
    exists (
      select 1
      from public.chats c
      join public.workspaces w on w.id = c.workspace_id
      where c.id = chat_id and w.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.chats c
      join public.workspaces w on w.id = c.workspace_id
      where c.id = chat_id and w.owner_id = auth.uid()
    )
  );

-- Citations: inherit access from their parent message.
create policy citations_rw_own on public.citations
  for all to authenticated
  using (
    exists (
      select 1
      from public.messages m
      join public.chats c on c.id = m.chat_id
      join public.workspaces w on w.id = c.workspace_id
      where m.id = message_id and w.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.messages m
      join public.chats c on c.id = m.chat_id
      join public.workspaces w on w.id = c.workspace_id
      where m.id = message_id and w.owner_id = auth.uid()
    )
  );

-- Bump last_message_at on chats whenever a new message lands, so the chats
-- list can sort by activity without a join. security definer so the trigger
-- runs even when the inserting role's RLS would block a direct chats update.
create or replace function public.bump_chat_last_message_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chats
     set last_message_at = new.created_at
   where id = new.chat_id;
  return new;
end;
$$;

create trigger messages_bump_chat_last_message_at
  after insert on public.messages
  for each row execute function public.bump_chat_last_message_at();
