-- Grant table-level privileges to the PostgREST roles.
--
-- Supabase historically auto-granted privileges on every table created by the
-- `postgres` role (via ALTER DEFAULT PRIVILEGES owned by `postgres`). Newer
-- Supabase images (CLI >= ~2.106 / the June 2026 hardening) removed those
-- postgres-owned default privileges, so tables our migrations create as
-- `postgres` now land with NO grants for anon/authenticated/service_role.
-- RLS policies then never get a chance to run — Postgres rejects the query at
-- the table-privilege layer with `42501 permission denied for table ...`.
--
-- This migration makes the grants explicit (correct on any image version) and
-- restores the default-privilege rule so future tables stay covered too. RLS
-- remains the real per-row gate; these grants only get the role *to* the table.

grant usage on schema public to anon, authenticated, service_role;

-- Existing tables / sequences.
grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;
grant usage, select on all sequences in schema public
  to anon, authenticated, service_role;

-- Future tables / sequences created by `postgres` (what migrations run as).
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables
  to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences
  to anon, authenticated, service_role;
