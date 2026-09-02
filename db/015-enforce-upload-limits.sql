-- =====================================================================
-- Migration 015 — enforce the file count the console configures
--
-- WHAT WAS WRONG
--
--   intake_documents.max_files is set per intake in the admin console
--   (Form setup -> Documents, 1 to 6). Nothing outside the browser ever
--   read it.
--
--     application_documents  documents_own_insert  -> owner + draft only
--     storage.objects        applicant_docs_insert -> owner + draft only
--
--   Neither policy counts anything. The only limit was the
--   `existing.length >= cfg.max` check in apps/applicant/app.js, which
--   an attacker holding the (public) anon key and a valid OTP session
--   simply does not run. They could:
--
--     * insert unbounded application_documents rows for one doc_type,
--       burying reviewers in files against a slot configured for one; and
--     * PUT unbounded 8 MB objects into applicant-documents, which is a
--       storage-cost denial of service with no ceiling at all.
--
-- WHAT THIS DOES
--
--   1. app.doc_file_limit()  — resolves the console's max_files for an
--      application's intake. Hidden or absent doc types resolve to 0.
--
--   2. A BEFORE INSERT trigger on application_documents enforcing that
--      limit exactly, serialised per (application, doc_type) so two
--      concurrent inserts cannot both pass the count.
--
--   3. The storage insert policy gains a ceiling per
--      <application>/<doc_type> folder: max_files plus a small retry
--      headroom. Headroom exists on purpose — see the note at part 3.
--
-- WHAT THIS DOES NOT DO
--
--   It does not touch existing rows. The trigger is INSERT-only, so an
--   intake whose max_files was lowered after applicants uploaded keeps
--   the files already there. Part 5 reports any such rows rather than
--   deleting them; deleting an applicant's evidence on a config change
--   is not a migration's decision to make.
--
--   It does not validate file contents. See migration 014.
--
-- Idempotent.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Resolve the console's limit
--
-- SECURITY DEFINER because the caller is the applicant, and the
-- applicant has no reason to hold a general read on intake_documents.
-- STABLE, so the planner may cache it within a statement.
--
-- Returns 0 for a doc type the intake does not offer or has hidden.
-- The id_document backstop covers an intake whose row is somehow
-- missing: the certified ID copy is mandatory by policy, and a limit of
-- 0 would lock the applicant out of submitting at all.
-- ---------------------------------------------------------------------
create or replace function app.doc_file_limit(p_application uuid, p_doc_type text)
returns smallint language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select d.max_files
       from public.applications a
       join public.intake_documents d
         on d.intake_id = a.intake_id
        and d.doc_type  = p_doc_type
      where a.id = p_application
        and d.visible),
    case when p_doc_type = 'id_document'
           and not exists (select 1
                             from public.applications a
                             join public.intake_documents d
                               on d.intake_id = a.intake_id
                              and d.doc_type = 'id_document'
                            where a.id = p_application)
         then 1::smallint
         else 0::smallint
    end);
$$;

grant execute on function app.doc_file_limit(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- 2. Enforce it on the catalogue
--
-- The advisory lock closes the race the browser guard cannot: two
-- requests arriving together both read count = 0 and both insert. It is
-- taken on (application_id, doc_type) so it never blocks a different
-- applicant, and it is transaction-scoped so it releases on commit or
-- rollback without any cleanup path.
--
-- SECURITY DEFINER so the count is the true count. Under the invoking
-- applicant's RLS the count would be filtered by documents_own_select —
-- correct today, but a policy change that narrowed that SELECT would
-- silently turn this limit into a no-op.
-- ---------------------------------------------------------------------
create or replace function app_private.enforce_doc_file_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_limit smallint;
  v_have  integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(new.application_id::text || ':' || new.doc_type, 0));

  v_limit := app.doc_file_limit(new.application_id, new.doc_type);

  if v_limit = 0 then
    raise exception
      'Document type % is not accepted for this intake', new.doc_type
      using errcode = 'check_violation',
            hint = 'The intake does not offer this document, or it is hidden.';
  end if;

  select count(*) into v_have
    from public.application_documents d
   where d.application_id = new.application_id
     and d.doc_type = new.doc_type;

  if v_have >= v_limit then
    raise exception
      'Upload limit reached: % file(s) allowed for %, % already uploaded',
      v_limit, new.doc_type, v_have
      using errcode = 'check_violation',
            hint = 'Remove an existing file before uploading another.';
  end if;

  return new;
end;
$$;

drop trigger if exists application_documents_file_limit
  on public.application_documents;
create trigger application_documents_file_limit
  before insert on public.application_documents
  for each row execute function app_private.enforce_doc_file_limit();


-- ---------------------------------------------------------------------
-- 3. Put a ceiling on the bucket
--
-- The catalogue trigger above is the exact limit. This is the ceiling
-- that stops the bucket being filled by someone who never bothers to
-- insert a catalogue row at all.
--
-- WHY THERE IS HEADROOM, AND WHY IT IS NOT A HOLE
--
--   app.js uploads the object first and inserts the catalogue row
--   second. If the insert fails, the object is left behind. With an
--   exact ceiling, every failed insert would permanently consume a slot
--   and an applicant could be locked out of a REQUIRED document —
--   turning a transient network error into an application they can
--   never submit. The headroom absorbs retries; the catalogue trigger
--   still holds the real line, so the extra objects are unreferenced
--   bytes, not extra documents a reviewer ever sees.
--
--   Worst case per application is therefore bounded at
--   sum(max_files + 3) over at most four doc types — roughly 20 objects,
--   ~160 MB, against unbounded before. Part 5 lists the orphans so they
--   can be queued for deletion.
--
-- SECURITY DEFINER is what makes this safe to call from a policy ON
-- storage.objects: a subquery over storage.objects evaluated under that
-- table's own RLS would recurse. Running as owner bypasses RLS.
--
-- The ownership check inside stops the function being used as a
-- counting oracle against another applicant's folder.
-- ---------------------------------------------------------------------
create or replace function app.storage_slot_free(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts  text[];
  v_app    uuid;
  v_doc    text;
  v_prefix text;
  v_limit  smallint;
  v_have   integer;
begin
  v_parts := storage.foldername(p_name);

  -- Path must be <application_id>/<doc_type>/<file>. Anything else is
  -- not a shape this application writes.
  --
  -- coalesce is load-bearing: array_length('{}', 1) is NULL, not 0, so
  -- `array_length(...) < 2` on an empty array evaluates to NULL and the
  -- IF falls through. Same NULL-comparison trap as the role guard in
  -- migration 008 — a bare-name object would have skipped the check.
  if v_parts is null or coalesce(array_length(v_parts, 1), 0) < 2 then
    return false;
  end if;

  begin
    v_app := v_parts[1]::uuid;
  exception when others then
    return false;
  end;

  v_doc := v_parts[2];

  -- Caller must own the draft. The storage policy checks this too; it is
  -- repeated here so the function cannot answer questions about folders
  -- belonging to anyone else.
  if not exists (select 1 from public.applications a
                  where a.id = v_app
                    and a.applicant_user_id = auth.uid()
                    and a.status = 'draft') then
    return false;
  end if;

  v_limit := app.doc_file_limit(v_app, v_doc);
  if v_limit = 0 then
    return false;
  end if;

  v_prefix := v_parts[1] || '/' || v_doc || '/';

  select count(*) into v_have
    from storage.objects o
   where o.bucket_id = 'applicant-documents'
     and left(o.name, length(v_prefix)) = v_prefix;

  return v_have < (v_limit + 3);
end;
$$;

grant execute on function app.storage_slot_free(text) to authenticated;

-- Replaces the policy from schema.sql. The ownership and draft clauses
-- are kept as they were; only the ceiling is new.
drop policy if exists applicant_docs_insert on storage.objects;
create policy applicant_docs_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'applicant-documents'
    and exists (select 1 from public.applications a
                where a.id::text = (storage.foldername(name))[1]
                  and a.applicant_user_id = auth.uid()
                  and a.status = 'draft')
    and app.storage_slot_free(name));


-- ---------------------------------------------------------------------
-- 4. Keep the console honest
--
-- saveDocs() in formsetup.js posts max_files straight from a number
-- input. The 1..6 CHECK on the column already refuses anything else,
-- but it refuses it with a raw Postgres message in an alert() box. A
-- BEFORE trigger clamping instead of rejecting means a fat-fingered 60
-- saves as 6 and the admin sees the clamped value on reload.
--
-- Clamping, not rejecting, is deliberate: this field is never
-- security-relevant in the upward direction — a larger number only ever
-- means more files, and the CHECK is the real bound.
-- ---------------------------------------------------------------------
create or replace function app_private.clamp_max_files()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.max_files is null then
    new.max_files := 1;
  end if;
  new.max_files := least(greatest(new.max_files, 1::smallint), 6::smallint);
  return new;
end;
$$;

drop trigger if exists intake_documents_clamp_max_files on public.intake_documents;
create trigger intake_documents_clamp_max_files
  before insert or update on public.intake_documents
  for each row execute function app_private.clamp_max_files();


-- ---------------------------------------------------------------------
-- 5. Verification and diagnostics
--
-- Results come back as a SELECT: the Supabase SQL editor shows result
-- sets, not RAISE NOTICE output.
-- ---------------------------------------------------------------------
select 'catalogue trigger installed' as check,
       case when exists (
         select 1 from pg_trigger
          where tgname = 'application_documents_file_limit'
            and not tgisinternal
       ) then 'yes' else 'NO' end as value

union all
select 'storage ceiling in insert policy',
       case when exists (
         select 1 from pg_policies
          where schemaname = 'storage' and tablename = 'objects'
            and policyname = 'applicant_docs_insert'
            and with_check like '%storage_slot_free%'
       ) then 'yes' else 'NO' end

-- The ceiling counts storage.objects, a table owned by
-- supabase_storage_admin with its own RLS. SECURITY DEFINER only escapes
-- that RLS if the function's owner is exempt from it. On Supabase the
-- editor runs as `postgres`, which holds BYPASSRLS, so it is — but if
-- this reads NO the ceiling silently counts 0 and never fires, so it is
-- checked rather than assumed.
union all
select 'ceiling owner is exempt from RLS',
       case when (select r.rolbypassrls or r.rolsuper
                    from pg_proc p
                    join pg_roles r on r.oid = p.proowner
                   where p.oid = 'app.storage_slot_free(text)'::regprocedure)
            then 'yes' else 'NO — the ceiling will not fire, see part 3' end

union all
select 'console clamp installed',
       case when exists (
         select 1 from pg_trigger
          where tgname = 'intake_documents_clamp_max_files'
            and not tgisinternal
       ) then 'yes' else 'NO' end

-- Rows already over the configured limit. Expected to be 0 on a clean
-- database. Anything here predates this migration and is left alone.
union all
select 'documents already over the limit',
       count(*)::text
  from (
    select d.application_id, d.doc_type, count(*) as n,
           app.doc_file_limit(d.application_id, d.doc_type) as lim
      from public.application_documents d
     group by d.application_id, d.doc_type
  ) g
 where g.n > g.lim

-- Objects in the bucket with no catalogue row. These are the failed
-- inserts the headroom exists for. Queue them with part 6 when the
-- number stops being small.
union all
select 'orphaned storage objects',
       count(*)::text
  from storage.objects o
 where o.bucket_id = 'applicant-documents'
   and not exists (select 1 from public.application_documents d
                    where d.storage_path = o.name);


-- ---------------------------------------------------------------------
-- 6. Orphan cleanup (run by hand, not part of the migration)
--
-- storage.objects cannot be deleted from SQL, so orphans go on the
-- purge queue and scan-worker.js drains it. Uncomment to queue them.
--
-- The 1 hour floor matters: an object younger than that may belong to
-- an upload whose catalogue insert is still in flight.
-- ---------------------------------------------------------------------
-- insert into public.storage_purge_queue (bucket_id, storage_path, application_id, reason)
-- select 'applicant-documents', o.name,
--        nullif((storage.foldername(o.name))[1], '')::uuid, 'orphan'
--   from storage.objects o
--  where o.bucket_id = 'applicant-documents'
--    and o.created_at < now() - interval '1 hour'
--    and not exists (select 1 from public.application_documents d
--                     where d.storage_path = o.name)
--    on conflict do nothing;
