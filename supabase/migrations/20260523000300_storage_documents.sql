-- Private storage bucket for uploaded source documents. The browser uploads
-- directly via short-lived signed URLs (architecture.md); the API never
-- proxies file bytes (avoids Vercel's 4.5 MB body limit, supports the 50 MB
-- target in REQ-1.1.1).
--
-- One bucket per Supabase project, and environments are separate projects, so
-- a static bucket name is reproducible in a migration. This is the documented
-- divergence from architecture.md's "uploads-dev/uploads-prod" naming.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

-- Objects are keyed `<workspace_id>/<upload_id>.pdf`. RLS scopes every object
-- to the owner of the workspace named by its first path segment
-- (defense-in-depth — signed upload URLs are minted server-side only for the
-- caller's own workspace).
create policy documents_objects_rw_own on storage.objects
  for all to authenticated
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.workspaces w
      where w.id = ((storage.foldername(name))[1])::uuid
        and w.owner_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'documents'
    and exists (
      select 1 from public.workspaces w
      where w.id = ((storage.foldername(name))[1])::uuid
        and w.owner_id = auth.uid()
    )
  );
