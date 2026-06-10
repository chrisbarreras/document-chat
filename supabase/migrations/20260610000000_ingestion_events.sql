-- Per-transition log for the ingestion pipeline. The chat / documents UI
-- and `GET /documents/{id}/ingestion-events` both read this table; the
-- Inngest extract → chunk → embed steps write a row on each state
-- transition (and any chunk_extracted / embedding_progress / warning event
-- we want to surface).
--
-- Modeled after the OpenAPI `IngestionEvent` schema; the contract values
-- map 1:1 to columns. RLS scopes every row to the parent document (which
-- the existing documents_rw_own policy already binds to the workspace
-- owner).

create type public.ingestion_event_kind as enum (
  'state_changed',
  'chunk_extracted',
  'embedding_progress',
  'warning',
  'failed'
);

create table public.ingestion_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  event public.ingestion_event_kind not null,
  from_state public.ingestion_state,
  to_state public.ingestion_state,
  progress_processed integer,
  progress_total integer,
  error jsonb,
  occurred_at timestamptz not null default now()
);

create index ingestion_events_document_id_idx
  on public.ingestion_events (document_id, occurred_at, id);

alter table public.ingestion_events enable row level security;

-- Events inherit access from the parent document.
create policy ingestion_events_rw_own on public.ingestion_events
  for all to authenticated
  using (
    exists (
      select 1
      from public.documents d
      join public.workspaces w on w.id = d.workspace_id
      where d.id = document_id and w.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.documents d
      join public.workspaces w on w.id = d.workspace_id
      where d.id = document_id and w.owner_id = auth.uid()
    )
  );
