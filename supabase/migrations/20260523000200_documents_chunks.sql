-- Documents and their embedded chunks. Both are scoped to the owning
-- workspace by RLS. Tier 1 subset of the OpenAPI Document/Chunk schemas.

create type public.document_status as enum ('draft', 'current', 'retired');

create type public.ingestion_state as enum (
  'pending', 'extracting', 'chunking', 'embedding', 'ready', 'failed'
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null,
  version text not null default '1.0',
  status public.document_status not null default 'current',
  effective_date date,
  ingestion_state public.ingestion_state not null default 'pending',
  ingestion_error text,
  size_bytes bigint not null,
  page_count integer,
  content_type text not null,
  storage_object_key text not null,
  embedding_model text not null,
  uploaded_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index documents_workspace_id_idx on public.documents (workspace_id);

create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  index integer not null,
  text text not null,
  token_count integer not null,
  embedding_model text not null,
  page_number integer,
  char_start integer not null,
  char_end integer not null,
  section_path text[],
  -- 1536 dims = OpenAI text-embedding-3-small (ADR / architecture.md).
  embedding extensions.vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, index)
);

create index chunks_document_id_idx on public.chunks (document_id);

-- ANN index for vector similarity search (REQ-1.1.4), cosine distance.
-- HNSW params per architecture.md (m = 16, ef_construction = 64).
create index chunks_embedding_hnsw on public.chunks
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create trigger chunks_set_updated_at
  before update on public.chunks
  for each row execute function public.set_updated_at();

alter table public.documents enable row level security;
alter table public.chunks enable row level security;

-- Documents: full access to rows in a workspace the caller owns.
create policy documents_rw_own on public.documents
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

-- Chunks: inherit access from their document's workspace.
create policy chunks_rw_own on public.chunks
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
