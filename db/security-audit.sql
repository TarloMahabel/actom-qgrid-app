-- =====================================================================
-- ACTOM Apprenticeship Portal — security audit
--
-- Read-only. Run against the LIVE Supabase project and read the output.
-- Everything reported as FAIL or WARN needs a decision; nothing here
-- changes anything.
--
--   Supabase SQL editor:  paste and run
--
-- Re-run after any schema change, and before each intake opens.
-- =====================================================================
\pset pager off

create or replace function pg_temp.chk(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  raise notice '% %  %', case when p_ok then 'PASS' else 'FAIL' end,
    rpad(p_name, 56), coalesce(p_detail, '');
end;
$$;

create or replace function pg_temp.warn(p_name text, p_clean boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  raise notice '% %  %', case when p_clean then 'PASS' else 'WARN' end,
    rpad(p_name, 56), coalesce(p_detail, '');
end;
$$;


-- =====================================================================
do $$
declare n int; t text;
begin
raise notice ' ';
raise notice '=== 1. ROW LEVEL SECURITY ===';

select count(*) into n from pg_tables tb
  join pg_class c on c.relname = tb.tablename and not c.relrowsecurity
 where tb.schemaname = 'public';
select string_agg(tb.tablename, ', ') into t from pg_tables tb
  join pg_class c on c.relname = tb.tablename and not c.relrowsecurity
 where tb.schemaname = 'public';
perform pg_temp.chk('RLS enabled on every public table', n = 0, coalesce(t, ''));

-- A table with RLS on but no policy is readable by nobody, which is safe
-- but usually a mistake — it means a feature is quietly broken.
select count(*) into n from pg_tables tb
  join pg_class c on c.relname = tb.tablename and c.relrowsecurity
 where tb.schemaname = 'public'
   and not exists (select 1 from pg_policies p
                    where p.schemaname = 'public' and p.tablename = tb.tablename);
select string_agg(tb.tablename, ', ') into t from pg_tables tb
  join pg_class c on c.relname = tb.tablename and c.relrowsecurity
 where tb.schemaname = 'public'
   and not exists (select 1 from pg_policies p
                    where p.schemaname = 'public' and p.tablename = tb.tablename);
perform pg_temp.warn('Every RLS table has at least one policy', n = 0, coalesce(t, ''));

-- USING (true) on a table holding personal data is worth a second look.
select count(*) into n from pg_policies
 where schemaname = 'public' and qual = 'true'
   and tablename in ('applications','application_subjects','application_documents',
                     'guardians','consents','apprentices','pii_access_log');
perform pg_temp.chk('No blanket USING(true) on personal data', n = 0);

raise notice ' ';
raise notice '=== 2. COLUMN PRIVILEGES ===';

select count(*) into n from information_schema.column_privileges
 where grantee in ('anon','authenticated')
   and column_name in ('id_number_enc','id_number_hash');
perform pg_temp.chk('Encrypted ID columns unreachable from the browser', n = 0, 'grants=' || n);

-- A table-level grant silently re-exposes every column, including ones
-- a later column-level revoke was meant to protect.
select count(*) into n from information_schema.role_table_grants
 where grantee in ('anon','authenticated') and table_schema = 'public'
   and table_name in ('applications','guardians') and privilege_type = 'SELECT';
perform pg_temp.chk('No table-level SELECT on identity tables', n = 0, 'grants=' || n);

select count(*) into n from information_schema.role_table_grants
 where grantee = 'anon' and table_schema = 'public'
   and privilege_type in ('INSERT','UPDATE','DELETE');
perform pg_temp.chk('anon cannot write to anything', n = 0, 'grants=' || n);

raise notice ' ';
raise notice '=== 3. FUNCTION HYGIENE ===';

select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
 where ns.nspname in ('public','app','app_private') and p.prosecdef
   and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%');
select string_agg(p.proname, ', ') into t from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
 where ns.nspname in ('public','app','app_private') and p.prosecdef
   and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%');
perform pg_temp.chk('SECURITY DEFINER functions pin search_path', n = 0, coalesce(t, ''));

-- anon should reach only the two functions the public form needs before
-- sign-in. Anything else is surface it does not need.
select count(*) into n from information_schema.role_routine_grants
 where grantee = 'anon' and specific_schema in ('public','app')
   and routine_name not in ('get_form_config','school_stream','validate_sa_id');
select string_agg(distinct routine_name, ', ') into t from information_schema.role_routine_grants
 where grantee = 'anon' and specific_schema in ('public','app')
   and routine_name not in ('get_form_config','school_stream','validate_sa_id');
perform pg_temp.warn('anon can execute only the public form helpers', n = 0, coalesce(t, ''));

select count(*) into n from information_schema.role_routine_grants
 where grantee in ('anon','authenticated') and specific_schema = 'app_private';
perform pg_temp.chk('app_private is not callable from the browser', n = 0, 'grants=' || n);

raise notice ' ';
raise notice '=== 4. ENCRYPTION AND KEYS ===';

select count(*) into n from vault.decrypted_secrets
 where name in ('applicant_id_key','applicant_id_pepper');
perform pg_temp.chk('Both Vault secrets exist', n = 2, 'found=' || n);

begin
  perform pg_temp.chk('Encryption round trip works',
    app_private.decrypt_id(app_private.encrypt_id('9803122081084')) = '9803122081084');
exception when others then
  perform pg_temp.chk('Encryption round trip works', false, SQLERRM);
end;

select count(*) into n from public.applications
 where id_number_enc is null and id_type is not null and status <> 'draft';
perform pg_temp.chk('Every submitted application has an encrypted ID', n = 0, 'missing=' || n);

raise notice ' ';
raise notice '=== 5. STORAGE ===';

select count(*) into n from storage.buckets
 where id = 'applicant-documents' and public = true;
perform pg_temp.chk('Applicant document bucket is private', n = 0);

select count(*) into n from storage.buckets
 where id = 'applicant-documents'
   and (allowed_mime_types is null or file_size_limit is null);
perform pg_temp.chk('Bucket enforces MIME allowlist and size cap', n = 0);

select count(*) into n from pg_policies
 where schemaname = 'storage' and tablename = 'objects';
perform pg_temp.warn('Storage object policies present', n >= 3, 'policies=' || n);

raise notice ' ';
raise notice '=== 6. RETENTION (POPIA s14) ===';

select count(*) into n from public.applications
 where legal_hold = false and status not in ('draft','enrolled')
   and purge_after is null and submitted_at is not null;
perform pg_temp.chk('Every submitted application has a deletion date', n = 0, 'missing=' || n);

select count(*) into n from public.applications
 where legal_hold = false and status <> 'enrolled'
   and purge_after is not null and purge_after < current_date;
perform pg_temp.warn('Nothing is overdue for deletion', n = 0,
  n || ' past their date — is the nightly job running?');

select count(*) into n from public.storage_purge_queue where deleted_at is null;
perform pg_temp.warn('Storage purge queue is being drained', n = 0,
  n || ' file(s) still in the bucket after their record was deleted');

-- pg_cron may not be readable by the running role; do not abort the audit.
begin
  execute 'select count(*) from cron.job where command like ''%purge_expired%''' into n;
  perform pg_temp.warn('Nightly retention job is scheduled', n > 0, 'jobs=' || n);
exception when others then
  perform pg_temp.warn('Nightly retention job is scheduled', false,
                       'could not read cron.job: ' || SQLERRM);
end;

raise notice ' ';
raise notice '=== 7. ACCESS CONTROL ===';

select count(*) into n from public.reviewer_profiles where active;
perform pg_temp.warn('Active reviewer count is deliberate', n > 0 and n < 25, 'active=' || n);

select count(*) into n from public.reviewer_profiles where active and role = 'admin';
perform pg_temp.warn('Administrators are few', n between 1 and 3, 'admins=' || n);

select count(*) into n from public.reviewer_profiles
 where active and lower(email) not like '%@actom.co.za';
select string_agg(email, ', ') into t from public.reviewer_profiles
 where active and lower(email) not like '%@actom.co.za';
perform pg_temp.chk('Every active reviewer is an ACTOM account', n = 0, coalesce(t, ''));

raise notice ' ';
raise notice '=== 8. AUDIT TRAIL ===';

select count(*) into n from information_schema.role_table_grants
 where grantee in ('anon','authenticated') and table_name = 'pii_access_log'
   and privilege_type in ('INSERT','UPDATE','DELETE');
perform pg_temp.chk('Audit log cannot be written or altered from the browser', n = 0);

select count(*) into n from public.pii_access_log where occurred_at > now() - interval '90 days';
perform pg_temp.warn('Audit log is recording activity', n > 0, 'entries in 90 days=' || n);

-- An ID revealed without a reason should be impossible; if any exist,
-- the reveal path has been bypassed.
select count(*) into n from public.pii_access_log
 where action = 'reveal_id' and (detail is null or length(btrim(detail)) < 5);
perform pg_temp.chk('Every ID reveal carries a reason', n = 0, 'without reason=' || n);

raise notice ' ';
raise notice '=== 9. CONSENT (POPIA s11, s35) ===';

select count(*) into n from public.consent_versions where active;
perform pg_temp.chk('Consent wording exists for applicant and guardian', n >= 2, 'versions=' || n);

select count(*) into n from public.applications a
 where a.status not in ('draft','withdrawn')
   and not exists (select 1 from public.consents c
                    where c.application_id = a.id and c.audience = 'applicant');
perform pg_temp.chk('Every submitted application has applicant consent', n = 0, 'missing=' || n);

select count(*) into n from public.applications a
 where a.is_minor and a.status not in ('draft','withdrawn')
   and not exists (select 1 from public.consents c
                    where c.application_id = a.id and c.audience = 'guardian');
perform pg_temp.chk('Every under-18 has guardian consent', n = 0, 'missing=' || n);

raise notice ' ';
raise notice '=== 10. UPLOADS ===';

select count(*) into n from public.application_documents where scan_status = 'pending';
perform pg_temp.warn('Uploaded documents have been malware scanned', n = 0,
  n || ' never scanned — no scanner is wired in yet');

raise notice ' ';
end $$;

\echo ''
\echo 'Audit complete. FAIL needs fixing. WARN needs a decision.'
