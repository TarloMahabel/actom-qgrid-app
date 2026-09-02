-- =====================================================================
-- Migration 006 — retention must not delete storage rows directly
--
-- THE BUG
--
--   app_private.purge_expired() ran:
--
--       delete from storage.objects where bucket_id = 'applicant-documents' ...
--
--   Supabase blocks that with a trigger:
--
--       Direct deletion from storage tables is not allowed.
--       Use the Storage API instead.
--
--   The exception aborts the whole function, so the nightly retention job
--   deleted NOTHING. Applications past their retention date were kept
--   indefinitely, silently, with no error surfaced anywhere a person
--   would see it. That is a POPIA s14 failure, not a cosmetic one.
--
--   It was invisible locally because stock PostgreSQL has no such
--   trigger. The test harness now reproduces it (db/test/00-shim.sql).
--
-- THE FIX
--
--   The database deletes the application rows, which it may, and records
--   the storage paths in a queue. A worker with the service-role key
--   removes the files through the Storage API and marks them done. The
--   two halves are separated because only one of them can be done in SQL.
--
--   Until a worker runs, the queue is the record of what is owed. An
--   application row is gone from the moment the purge runs — the file is
--   removed shortly after. Anyone asking whether retention is being
--   honoured should be shown the queue depth, which is why there is a
--   view for it.
--
-- Run after 005-school-stream.sql. Idempotent.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The queue
-- ---------------------------------------------------------------------
create table if not exists public.storage_purge_queue (
  id             bigserial primary key,
  bucket_id      text not null default 'applicant-documents',
  storage_path   text not null,
  application_id uuid,                 -- kept for tracing; the row is gone
  reason         text not null default 'retention',
  queued_at      timestamptz not null default now(),
  attempts       smallint not null default 0,
  last_error     text,
  deleted_at     timestamptz
);

create index if not exists storage_purge_pending_idx
  on public.storage_purge_queue (queued_at)
  where deleted_at is null;

create unique index if not exists storage_purge_path_idx
  on public.storage_purge_queue (bucket_id, storage_path)
  where deleted_at is null;

alter table public.storage_purge_queue enable row level security;

-- Oversight roles may read it; nobody writes it through the API.
drop policy if exists storage_purge_read on public.storage_purge_queue;
create policy storage_purge_read on public.storage_purge_queue for select
  using (app.reviewer_role() in ('admin','manager','information_officer'));

revoke all on public.storage_purge_queue from anon, authenticated;
grant select on public.storage_purge_queue to authenticated;
revoke all on sequence public.storage_purge_queue_id_seq from anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. Retention, corrected
-- ---------------------------------------------------------------------
create or replace function app_private.purge_expired()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer := 0; r record;
begin
  for r in
    select id from public.applications
     where legal_hold = false and purge_after is not null and purge_after < current_date
  loop
    -- Queue the files. storage.objects cannot be deleted from SQL, and
    -- attempting it aborts this entire function.
    insert into public.storage_purge_queue (bucket_id, storage_path, application_id, reason)
    select 'applicant-documents', d.storage_path, d.application_id, 'retention'
      from public.application_documents d
     where d.application_id = r.id
    on conflict do nothing;

    delete from public.applications where id = r.id;
    v_count := v_count + 1;
  end loop;

  -- Abandoned drafts: no submission within 90 days of the intake closing.
  insert into public.storage_purge_queue (bucket_id, storage_path, application_id, reason)
  select 'applicant-documents', d.storage_path, d.application_id, 'abandoned_draft'
    from public.application_documents d
    join public.applications a on a.id = d.application_id
    join public.intakes i on i.id = a.intake_id
   where a.status = 'draft' and a.legal_hold = false
     and i.closes_at < now() - interval '90 days'
  on conflict do nothing;

  delete from public.applications a
   using public.intakes i
   where a.intake_id = i.id and a.status = 'draft'
     and i.closes_at < now() - interval '90 days' and a.legal_hold = false;

  -- Audit logs are kept for three years, then aged out.
  delete from public.pii_access_log where occurred_at < now() - interval '3 years';

  insert into public.application_events (event, detail)
  values ('retention_purge', jsonb_build_object(
            'applications_deleted', v_count,
            'files_queued', (select count(*) from public.storage_purge_queue
                              where deleted_at is null)));

  return v_count;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. Cleaning up after a withdrawn or edited draft
--
-- When an applicant removes a document the client deletes the object
-- through the Storage API, which is allowed. This trigger covers the
-- other paths — a cascade, an admin correction — where the row goes but
-- nothing called the API.
-- ---------------------------------------------------------------------
create or replace function app_private.queue_document_file()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.storage_purge_queue (bucket_id, storage_path, application_id, reason)
  values ('applicant-documents', old.storage_path, old.application_id, 'row_deleted')
  on conflict do nothing;
  return old;
end;
$$;

drop trigger if exists application_documents_queue_file on public.application_documents;
create trigger application_documents_queue_file
  after delete on public.application_documents
  for each row execute function app_private.queue_document_file();


-- ---------------------------------------------------------------------
-- 4. Oversight
--
-- If the worker stops, this is where it shows. A queue that only grows
-- means files ACTOM has undertaken to delete are still sitting in the
-- bucket — worth a monitor, not a quarterly discovery.
-- ---------------------------------------------------------------------
create or replace view public.v_storage_purge_status as
select
  count(*) filter (where deleted_at is null)                        as pending,
  count(*) filter (where deleted_at is not null)                    as deleted,
  count(*) filter (where deleted_at is null and attempts >= 3)      as failing,
  min(queued_at) filter (where deleted_at is null)                  as oldest_pending,
  max(deleted_at)                                                   as last_success
  from public.storage_purge_queue;

grant select on public.v_storage_purge_status to authenticated;


-- ---------------------------------------------------------------------
-- 5. Marking work done
--
-- Called by the worker once the Storage API has confirmed a delete.
-- ---------------------------------------------------------------------
create or replace function public.mark_storage_purged(p_ids bigint[])
returns integer language plpgsql security definer set search_path = '' as $$
declare v integer;
begin
  if app.reviewer_role() is distinct from 'admin'
     and current_user not in ('postgres', 'service_role') then
    raise exception 'Not authorised.';
  end if;
  update public.storage_purge_queue
     set deleted_at = now(), last_error = null
   where id = any(p_ids) and deleted_at is null;
  get diagnostics v = row_count;
  return v;
end;
$$;

create or replace function public.record_storage_purge_error(p_id bigint, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.storage_purge_queue
     set attempts = attempts + 1, last_error = left(coalesce(p_error, ''), 400)
   where id = p_id;
end;
$$;

grant execute on function public.mark_storage_purged(bigint[]) to authenticated;
grant execute on function public.record_storage_purge_error(bigint, text) to authenticated;


-- ---------------------------------------------------------------------
-- 6. Backfill
--
-- Any application already past its retention date has been sitting there
-- because the purge could not complete. Run it now that it can.
-- ---------------------------------------------------------------------
do $$
declare n integer;
begin
  n := app_private.purge_expired();
  raise notice 'Purge run: % application(s) deleted, % file(s) pending removal.',
    n, (select count(*) from public.storage_purge_queue where deleted_at is null);
end $$;


-- ---------------------------------------------------------------------
-- What still needs doing OUTSIDE the database
--
-- A worker must empty the queue. Deploy a Supabase Edge Function on a
-- schedule (or a Netlify scheduled function) that:
--
--   1. selects id, bucket_id, storage_path
--        from storage_purge_queue where deleted_at is null limit 100
--   2. calls storage.from(bucket).remove([paths]) with the SERVICE ROLE key
--   3. calls mark_storage_purged(ids) for those that succeeded,
--      record_storage_purge_error(id, message) for those that did not
--
-- Until that exists the files remain in the bucket. The database rows are
-- gone, so no reviewer can reach them, but the objects are still stored —
-- which is not what "deleted after 12 months" means to an applicant or to
-- the Information Regulator. Treat the worker as part of go-live, not as
-- a follow-up.
--
-- Monitor with:  select * from public.v_storage_purge_status;
-- ---------------------------------------------------------------------
