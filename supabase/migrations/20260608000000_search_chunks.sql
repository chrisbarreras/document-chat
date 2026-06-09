-- Vector search RPC: cosine kNN over chunks scoped to a workspace, excluding
-- retired documents per REQ-1.3.4 / REQ-1.4.2.
--
-- Exposed as a Postgres function so the JS Supabase client can invoke it via
-- `.rpc('search_chunks', …)`. PostgREST does not expose the `<=>` operator
-- through the query builder, but a SECURITY INVOKER function preserves RLS:
-- the caller's JWT context still applies inside the function body, so
-- chunks/documents the user can't see are filtered by the existing
-- `chunks_rw_own` / `documents_rw_own` policies before the kNN runs.
--
-- The function runs with `search_path = ''` (Supabase hardening guidance:
-- avoid surprise resolutions). That means we must reference pgvector's
-- cosine-distance operator by its fully-qualified form via the OPERATOR
-- syntax: `OPERATOR(extensions.<=>)`. A bare `<=>` or `extensions.<=>` in
-- expression position is a syntax error in PostgreSQL.
--
-- The HNSW index on chunks(embedding) (created in the documents_chunks
-- migration) is used automatically when ORDER BY uses the cosine `<=>`
-- operator.

create or replace function public.search_chunks(
  p_workspace_id uuid,
  p_query_embedding extensions.vector(1536),
  p_top_k integer default 8
)
returns table (
  id uuid,
  document_id uuid,
  document_title text,
  document_version text,
  index integer,
  text text,
  token_count integer,
  embedding_model text,
  page_number integer,
  char_start integer,
  char_end integer,
  section_path text[],
  score double precision,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.document_id,
    d.title         as document_title,
    d.version       as document_version,
    c.index,
    c.text,
    c.token_count,
    c.embedding_model,
    c.page_number,
    c.char_start,
    c.char_end,
    c.section_path,
    -- Cosine similarity = 1 - cosine distance. Bounded [0, 2]; higher = closer.
    (1 - (c.embedding OPERATOR(extensions.<=>) p_query_embedding))::double precision as score,
    c.created_at,
    c.updated_at
  from public.chunks c
  join public.documents d on d.id = c.document_id
  where d.workspace_id = p_workspace_id
    and d.status <> 'retired'
    and c.embedding is not null
  order by c.embedding OPERATOR(extensions.<=>) p_query_embedding
  limit greatest(1, least(p_top_k, 50));
$$;

-- Allow authenticated callers to invoke. RLS still applies inside the body.
grant execute on function public.search_chunks(uuid, extensions.vector, integer) to authenticated;
