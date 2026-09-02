-- =====================================================================
-- Migration 014 — restrict uploads to PDF, JPEG and PNG
--
-- HEIC is dropped. The browser changes (config.js, app.js) are the
-- usability half; this is the half that is actually enforced, because
-- everything in the browser can be skipped by a crafted request.
--
-- READ THIS BEFORE ASSUMING IT IS AIRTIGHT
--
--   storage.buckets.allowed_mime_types validates the Content-Type the
--   CLIENT DECLARES on the upload request. It does not look at the
--   bytes. Someone posting directly to the Storage API can still put
--   arbitrary content in the bucket labelled 'application/pdf'.
--
--   The magic-byte check that would catch that runs in app.js, in the
--   applicant's browser, which an attacker simply does not use.
--
--   So treat this as tightening the front door, not as content
--   validation. The controls that actually stop a hostile file being
--   opened are the scanner (F4) and the scan_status = 'clean' gate on
--   the storage read policy. Neither is replaced by this migration.
--
-- Idempotent.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The bucket
-- ---------------------------------------------------------------------
update storage.buckets
   set allowed_mime_types = array['application/pdf','image/jpeg','image/png']
 where id = 'applicant-documents';


-- ---------------------------------------------------------------------
-- 2. The catalogue
--
-- application_documents.mime_type had no constraint, so a row could
-- record a type the bucket would never have accepted. Existing rows are
-- checked first: if any HEIC was uploaded before this change, the
-- constraint is skipped rather than failing the migration, and the
-- notice tells you what to deal with.
-- ---------------------------------------------------------------------
do $$
declare n int; t text;
begin
  select count(*), string_agg(distinct mime_type, ', ')
    into n, t
    from public.application_documents
   where mime_type not in ('application/pdf','image/jpeg','image/png');

  if n > 0 then
    raise notice 'SKIPPED the constraint: % existing document(s) use %', n, t;
    raise notice 'Convert or remove them, then re-run this migration.';
    raise notice 'Find them with:';
    raise notice '  select id, application_id, original_filename, mime_type';
    raise notice '    from public.application_documents';
    raise notice '   where mime_type not in (''application/pdf'',''image/jpeg'',''image/png'');';
  else
    alter table public.application_documents
      drop constraint if exists application_documents_mime_allowed;
    alter table public.application_documents
      add constraint application_documents_mime_allowed
      check (mime_type in ('application/pdf','image/jpeg','image/png'));
    raise notice 'Constraint applied: catalogue now accepts PDF, JPEG and PNG only.';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 3. Verification
-- ---------------------------------------------------------------------
select 'bucket allowed types' as check,
       array_to_string(allowed_mime_types, ', ') as value
  from storage.buckets where id = 'applicant-documents'
union all
select 'catalogue constraint present',
       case when exists (
         select 1 from pg_constraint
          where conname = 'application_documents_mime_allowed'
       ) then 'yes' else 'NO — see the notices above' end
union all
select 'documents outside the allowlist',
       count(*)::text
  from public.application_documents
 where mime_type not in ('application/pdf','image/jpeg','image/png');
