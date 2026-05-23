-- Workspaces. Tier 1 is one workspace per user (REQ-1.NF.2), auto-provisioned
-- on signup. RLS scopes every row to its owner.

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One workspace per user (Tier 1); slugs are globally unique.
create unique index workspaces_owner_id_key on public.workspaces (owner_id);
create unique index workspaces_slug_key on public.workspaces (slug);

alter table public.workspaces enable row level security;

-- Owner may read and update their workspace. Inserts come only from the signup
-- trigger (security definer, below); deletes cascade from auth.users.
create policy workspaces_select_own on public.workspaces
  for select to authenticated
  using (auth.uid() = owner_id);

create policy workspaces_update_own on public.workspaces
  for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Shared updated_at maintenance trigger.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

-- Auto-provision a workspace for every new auth user. security definer so it
-- can write through RLS; empty search_path per Supabase hardening guidance
-- (all objects are schema-qualified).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_slug text;
  candidate text;
  n int := 0;
begin
  base_slug := nullif(split_part(coalesce(new.email, ''), '@', 1), '');
  if base_slug is null then
    base_slug := 'workspace';
  end if;

  candidate := base_slug;
  while exists (select 1 from public.workspaces where slug = candidate) loop
    n := n + 1;
    candidate := base_slug || '-' || n::text;
  end loop;

  insert into public.workspaces (owner_id, name, slug)
  values (new.id, base_slug || '''s workspace', candidate);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
