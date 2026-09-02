-- =====================================================================
-- Adversarial tests
--
-- Each block attempts something an attacker would try, as the actual
-- anon or authenticated role. A PASS means the attempt was refused.
--
-- Run after 90-security-tests.sql against a throwaway database.
-- =====================================================================
\pset pager off

create or replace function pg_temp.blocked(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  raise notice '% %  %', case when p_ok then 'BLOCKED' else 'BREACH ' end,
    rpad(p_name, 54), coalesce(p_detail, '');
end;
$$;

-- Fixtures: an applicant, a second applicant, and a scoped reviewer.
do $$
declare v_intake uuid; v_t1 uuid; v_t2 uuid;
begin
  insert into auth.users (id, email) values
    ('aaaa1111-1111-4111-8111-111111111111', 'victim@example.com'),
    ('bbbb2222-2222-4222-8222-222222222222', 'attacker@example.com'),
    ('cccc3333-3333-4333-8333-333333333333', 'scoped@actom.co.za')
  on conflict do nothing;

  insert into public.reviewer_profiles (user_id, email, role, active)
  values ('cccc3333-3333-4333-8333-333333333333', 'scoped@actom.co.za', 'reviewer', true)
  on conflict (user_id) do update set active = true, role = 'reviewer';

  select id into v_intake from public.intakes where status = 'open' limit 1;
  select trade_id into v_t1 from public.intake_trades where intake_id = v_intake and active
   order by trade_id limit 1;
  select trade_id into v_t2 from public.intake_trades where intake_id = v_intake and active
   order by trade_id desc limit 1;

  -- The scoped reviewer may see trade 1 only.
  delete from public.reviewer_trades where user_id = 'cccc3333-3333-4333-8333-333333333333';
  insert into public.reviewer_trades (user_id, trade_id)
  values ('cccc3333-3333-4333-8333-333333333333', v_t1);

  insert into public.applications
    (id, applicant_user_id, intake_id, trade_id, status, full_name, contact_number,
     address_line1, city, grade12_type)
  values
    ('11110000-0000-4000-8000-000000000001','aaaa1111-1111-4111-8111-111111111111',
     v_intake, v_t1, 'submitted', 'Victim One', '0820000001', '1 Main', 'Benoni', 'nsc'),
    ('22220000-0000-4000-8000-000000000002','aaaa1111-1111-4111-8111-111111111111',
     v_intake, v_t2, 'submitted', 'Victim Two', '0820000002', '2 Main', 'Benoni', 'nsc')
  on conflict (id) do nothing;
end $$;


-- =====================================================================
-- As an APPLICANT (authenticated, not staff)
-- =====================================================================
set role authenticated;
select set_config('test.uid', 'bbbb2222-2222-4222-8222-222222222222', false);
select set_config('test.jwt', '{"email":"attacker@example.com"}', false);

do $$
declare n int;
begin
  raise notice ' ';
  raise notice '=== AS AN APPLICANT ===';

  -- Read someone else's application
  select count(*) into n from public.applications
   where id = '11110000-0000-4000-8000-000000000001';
  perform pg_temp.blocked('read another applicant''s record', n = 0, 'rows=' || n);

  -- Read the whole table
  select count(*) into n from public.applications;
  perform pg_temp.blocked('enumerate all applications', n = 0, 'rows=' || n);

  -- Read someone else's documents
  select count(*) into n from public.application_documents;
  perform pg_temp.blocked('list other applicants'' documents', n = 0, 'rows=' || n);

  -- Read guardians (contains a minor's guardian details)
  select count(*) into n from public.guardians;
  perform pg_temp.blocked('read guardian records', n = 0, 'rows=' || n);

  -- Read the register
  begin
    select count(*) into n from public.apprentices;
    perform pg_temp.blocked('read the apprentice register', n = 0, 'rows=' || n);
  exception when insufficient_privilege then
    perform pg_temp.blocked('read the apprentice register', true, 'privilege denied');
  end;

  -- Read the audit log
  select count(*) into n from public.pii_access_log;
  perform pg_temp.blocked('read the PII access log', n = 0, 'rows=' || n);

  -- Grant themselves reviewer access
  begin
    insert into public.reviewer_profiles (user_id, email, role, active)
    values ('bbbb2222-2222-4222-8222-222222222222', 'attacker@example.com', 'admin', true);
    perform pg_temp.blocked('self-grant reviewer access', false, 'INSERT SUCCEEDED');
  exception when others then
    perform pg_temp.blocked('self-grant reviewer access', true);
  end;

  -- Activate themselves if a row already existed
  begin
    update public.reviewer_profiles set active = true, role = 'admin'
     where user_id = 'bbbb2222-2222-4222-8222-222222222222';
    select count(*) into n from public.reviewer_profiles
     where user_id = 'bbbb2222-2222-4222-8222-222222222222' and active;
    perform pg_temp.blocked('self-activate as reviewer', n = 0, 'active rows=' || n);
  exception when others then
    perform pg_temp.blocked('self-activate as reviewer', true);
  end;

  -- Call a reviewer-only RPC
  begin
    perform public.reveal_id_number('11110000-0000-4000-8000-000000000001', 'because I want it');
    perform pg_temp.blocked('reveal another applicant''s ID number', false, 'RETURNED A VALUE');
  exception when others then
    perform pg_temp.blocked('reveal another applicant''s ID number', true);
  end;

  -- Enrol themselves
  begin
    perform public.enrol_applicant('11110000-0000-4000-8000-000000000001', current_date);
    perform pg_temp.blocked('enrol an applicant', false, 'SUCCEEDED');
  exception when others then
    perform pg_temp.blocked('enrol an applicant', true);
  end;

  -- Change an intake's configuration.
  -- Count the rows actually changed: an UPDATE that RLS filters to zero
  -- rows raises nothing and looks identical to one that was permitted.
  -- Reporting on the absence of an exception alone would call this safe
  -- whether it was blocked or not.
  begin
    update public.intake_trade_subjects set weight = 10;
    get diagnostics n = row_count;
    perform pg_temp.blocked('rewrite the scoring rules', n = 0, 'rows changed=' || n);
  exception when others then
    perform pg_temp.blocked('rewrite the scoring rules', true, 'refused outright');
  end;

  -- Publish an intake
  begin
    perform public.publish_intake((select id from public.intakes limit 1));
    perform pg_temp.blocked('publish an intake', false, 'SUCCEEDED');
  exception when others then
    perform pg_temp.blocked('publish an intake', true);
  end;

  -- Call an internal helper directly
  begin
    perform app_private.decrypt_id(
      (select id_number_enc from public.applications limit 1));
    perform pg_temp.blocked('call app_private.decrypt_id', false, 'SUCCEEDED');
  exception when others then
    perform pg_temp.blocked('call app_private.decrypt_id', true);
  end;

  -- Read the Vault
  begin
    select count(*) into n from vault.decrypted_secrets;
    perform pg_temp.blocked('read Vault secrets', n = 0, 'rows=' || n);
  exception when others then
    perform pg_temp.blocked('read Vault secrets', true);
  end;

  -- Tamper with the audit log
  begin
    delete from public.pii_access_log;
    perform pg_temp.blocked('delete audit entries', false, 'DELETE SUCCEEDED');
  exception when others then
    perform pg_temp.blocked('delete audit entries', true);
  end;
end $$;


-- =====================================================================
-- UPLOAD COUNT LIMITS (migration 015)
--
-- Everything above asks "can an attacker touch someone else's data".
-- This asks a different question: an applicant acting entirely within
-- their OWN draft, which every policy legitimately permits, must still
-- be held to the file count the admin console configured.
--
-- The browser check in app.js is not exercised here on purpose. These
-- run as the real `authenticated` role over the SQL interface, which is
-- exactly what an attacker holding the public anon key and a valid OTP
-- session has.
--
-- A separate fixture user is used rather than the attacker above,
-- because giving that attacker an application of their own would make
-- the "enumerate all applications" and "list other applicants'
-- documents" checks return 1 row legitimately and report a false BREACH.
-- =====================================================================
reset role;

-- Positive counterpart to blocked(). A limit that refuses everything is
-- not a working limit, so the allowed path is asserted too.
create or replace function pg_temp.works(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  raise notice '% %  %', case when p_ok then 'OK     ' else 'FAILED ' end,
    rpad(p_name, 54), coalesce(p_detail, '');
end;
$$;

do $$
declare v_intake uuid; v_t1 uuid;
begin
  insert into auth.users (id, email) values
    ('dddd4444-4444-4444-8444-444444444444', 'uploader@example.com')
  on conflict do nothing;

  select id into v_intake from public.intakes where status = 'open' limit 1;
  select trade_id into v_t1 from public.intake_trades
   where intake_id = v_intake and active order by trade_id limit 1;

  -- Their own DRAFT: documents_own_insert requires draft status.
  insert into public.applications
    (id, applicant_user_id, intake_id, trade_id, status, full_name, contact_number,
     address_line1, city, grade12_type)
  values
    ('44440000-0000-4000-8000-000000000004','dddd4444-4444-4444-8444-444444444444',
     v_intake, v_t1, 'draft', 'Uploader Four', '0820000004', '4 Main', 'Benoni', 'nsc')
  on conflict (id) do update set status = 'draft';

  delete from public.application_documents
   where application_id = '44440000-0000-4000-8000-000000000004';

  -- The console configuration these tests are measured against.
  update public.intake_documents set max_files = 1, visible = true
   where intake_id = v_intake and doc_type = 'id_document';
  update public.intake_documents set max_files = 2, visible = true
   where intake_id = v_intake and doc_type = 'qualification';
  update public.intake_documents set visible = false
   where intake_id = v_intake and doc_type = 'other';
end $$;

set role authenticated;
select set_config('test.uid', 'dddd4444-4444-4444-8444-444444444444', false);
select set_config('test.jwt', '{"email":"uploader@example.com"}', false);

do $$
declare
  v_app uuid := '44440000-0000-4000-8000-000000000004';
  n int;
begin
  raise notice ' ';
  raise notice '=== UPLOAD COUNT LIMITS, INSIDE THEIR OWN DRAFT ===';

  -- The limit must come from the console, not from a constant in a
  -- trigger. If this reports the wrong number nothing below means
  -- anything, so it is checked first.
  perform pg_temp.works('limit resolves to the configured 1 for id_document',
    app.doc_file_limit(v_app, 'id_document') = 1,
    'got ' || app.doc_file_limit(v_app, 'id_document'));
  perform pg_temp.works('limit resolves to the configured 2 for qualification',
    app.doc_file_limit(v_app, 'qualification') = 2,
    'got ' || app.doc_file_limit(v_app, 'qualification'));

  -- One file into a max:1 slot is legitimate and must succeed.
  begin
    insert into public.application_documents
      (application_id, doc_type, storage_path, original_filename, mime_type, size_bytes)
    values (v_app, 'id_document', v_app || '/id_document/a.pdf', 'a.pdf',
            'application/pdf', 1024);
    perform pg_temp.works('first file into a max:1 slot accepted', true);
  exception when others then
    perform pg_temp.works('first file into a max:1 slot accepted', false, sqlerrm);
  end;

  -- The second must not be, however it is submitted.
  begin
    insert into public.application_documents
      (application_id, doc_type, storage_path, original_filename, mime_type, size_bytes)
    values (v_app, 'id_document', v_app || '/id_document/b.pdf', 'b.pdf',
            'application/pdf', 1024);
    perform pg_temp.blocked('exceed max_files on their own draft', false, 'INSERT SUCCEEDED');
  exception when others then
    perform pg_temp.blocked('exceed max_files on their own draft', true);
  end;

  select count(*) into n from public.application_documents
   where application_id = v_app and doc_type = 'id_document';
  perform pg_temp.blocked('count stays at the configured maximum', n = 1, 'rows=' || n);

  -- A single statement inserting several rows at once. A trigger that
  -- only ever sees one row per statement would let this through.
  begin
    insert into public.application_documents
      (application_id, doc_type, storage_path, original_filename, mime_type, size_bytes)
    select v_app, 'qualification',
           v_app || '/qualification/bulk-' || g || '.pdf', 'bulk.pdf',
           'application/pdf', 1024
      from generate_series(1, 5) g;
    perform pg_temp.blocked('bulk-insert past the limit in one statement',
      false, 'INSERT SUCCEEDED');
  exception when others then
    perform pg_temp.blocked('bulk-insert past the limit in one statement', true);
  end;

  select count(*) into n from public.application_documents
   where application_id = v_app and doc_type = 'qualification';
  perform pg_temp.blocked('bulk insert left nothing behind', n = 0, 'rows=' || n);

  -- Fill the max:2 slot properly, one row at a time.
  begin
    insert into public.application_documents
      (application_id, doc_type, storage_path, original_filename, mime_type, size_bytes)
    values (v_app, 'qualification', v_app || '/qualification/c.pdf', 'c.pdf',
            'application/pdf', 1024);
    insert into public.application_documents
      (application_id, doc_type, storage_path, original_filename, mime_type, size_bytes)
    values (v_app, 'qualification', v_app || '/qualification/d.pdf', 'd.pdf',
            'application/pdf', 1024);
    perform pg_temp.works('both files into a max:2 slot accepted', true);
  exception when others then
    perform pg_temp.works('both files into a max:2 slot accepted', false, sqlerrm);
  end;

  begin
    insert into public.application_documents
      (application_id, doc_type, storage_path, original_filename, mime_type, size_bytes)
    values (v_app, 'qualification', v_app || '/qualification/e.pdf', 'e.pdf',
            'application/pdf', 1024);
    perform pg_temp.blocked('third file into a max:2 slot', false, 'INSERT SUCCEEDED');
  exception when others then
    perform pg_temp.blocked('third file into a max:2 slot', true);
  end;

  -- A doc type the console has hidden is not on offer, so uploading
  -- against it must fail even though the doc_type CHECK permits the value.
  begin
    insert into public.application_documents
      (application_id, doc_type, storage_path, original_filename, mime_type, size_bytes)
    values (v_app, 'other', v_app || '/other/x.pdf', 'x.pdf',
            'application/pdf', 1024);
    perform pg_temp.blocked('upload against a hidden document type',
      false, 'INSERT SUCCEEDED');
  exception when others then
    perform pg_temp.blocked('upload against a hidden document type', true);
  end;

  -- Limits are per doc_type, not one pooled allowance. A full slot must
  -- not close a slot that still has room.
  begin
    insert into public.application_documents
      (application_id, doc_type, storage_path, original_filename, mime_type, size_bytes)
    values (v_app, 'matric_certificate', v_app || '/matric_certificate/m.pdf', 'm.pdf',
            'application/pdf', 1024);
    perform pg_temp.works('a full slot does not close a different slot', true);
  exception when others then
    perform pg_temp.works('a full slot does not close a different slot', false, sqlerrm);
  end;

  -- The applicant must not be able to raise their own ceiling.
  begin
    update public.intake_documents set max_files = 6
     where doc_type = 'id_document';
    select count(*) into n from public.intake_documents
     where doc_type = 'id_document' and max_files = 6;
    perform pg_temp.blocked('raise their own max_files', n = 0, 'rows changed=' || n);
  exception when others then
    perform pg_temp.blocked('raise their own max_files', true, 'refused outright');
  end;
end $$;


-- ---------------------------------------------------------------------
-- The limit must TRACK the console, in both directions. A trigger
-- reading a hardcoded number would pass everything above and fail here.
-- ---------------------------------------------------------------------
reset role;

do $$
declare v_intake uuid;
begin
  select intake_id into v_intake from public.applications
   where id = '44440000-0000-4000-8000-000000000004';
  update public.intake_documents set max_files = 3
   where intake_id = v_intake and doc_type = 'qualification';
end $$;

set role authenticated;

do $$
declare v_app uuid := '44440000-0000-4000-8000-000000000004'; n int;
begin
  perform pg_temp.works('raising max_files in the console raises the limit',
    app.doc_file_limit(v_app, 'qualification') = 3,
    'got ' || app.doc_file_limit(v_app, 'qualification'));

  -- The file refused a moment ago is now allowed, with no code change.
  begin
    insert into public.application_documents
      (application_id, doc_type, storage_path, original_filename, mime_type, size_bytes)
    values (v_app, 'qualification', v_app || '/qualification/e.pdf', 'e.pdf',
            'application/pdf', 1024);
    perform pg_temp.works('the previously refused third file now goes through', true);
  exception when others then
    perform pg_temp.works('the previously refused third file now goes through', false, sqlerrm);
  end;

  select count(*) into n from public.application_documents
   where application_id = v_app and doc_type = 'qualification';
  perform pg_temp.works('slot now holds three', n = 3, 'rows=' || n);
end $$;

reset role;

-- Lowering the limit below what is already uploaded must not destroy an
-- applicant's evidence — it only stops additions. Migration 015 reports
-- these rows rather than deleting them.
do $$
declare v_intake uuid; n int;
begin
  select intake_id into v_intake from public.applications
   where id = '44440000-0000-4000-8000-000000000004';
  update public.intake_documents set max_files = 1
   where intake_id = v_intake and doc_type = 'qualification';

  select count(*) into n from public.application_documents
   where application_id = '44440000-0000-4000-8000-000000000004'
     and doc_type = 'qualification';
  perform pg_temp.works('lowering max_files keeps files already uploaded', n = 3, 'rows=' || n);
end $$;

set role authenticated;

do $$
declare v_app uuid := '44440000-0000-4000-8000-000000000004';
begin
  begin
    insert into public.application_documents
      (application_id, doc_type, storage_path, original_filename, mime_type, size_bytes)
    values (v_app, 'qualification', v_app || '/qualification/f.pdf', 'f.pdf',
            'application/pdf', 1024);
    perform pg_temp.blocked('add a file after the limit was lowered',
      false, 'INSERT SUCCEEDED');
  exception when others then
    perform pg_temp.blocked('add a file after the limit was lowered', true);
  end;
end $$;

-- The console clamp. saveDocs() posts a number input straight through;
-- an out-of-range value must land inside 1..6 rather than surfacing a
-- constraint message, and must never land at 0 (which would lock the
-- applicant out of a required document).
reset role;

do $$
declare v_intake uuid; v smallint;
begin
  select intake_id into v_intake from public.applications
   where id = '44440000-0000-4000-8000-000000000004';

  update public.intake_documents set max_files = 60
   where intake_id = v_intake and doc_type = 'qualification';
  select max_files into v from public.intake_documents
   where intake_id = v_intake and doc_type = 'qualification';
  perform pg_temp.works('max_files of 60 clamps to 6', v = 6, 'stored ' || v);

  update public.intake_documents set max_files = -3
   where intake_id = v_intake and doc_type = 'qualification';
  select max_files into v from public.intake_documents
   where intake_id = v_intake and doc_type = 'qualification';
  perform pg_temp.works('max_files of -3 clamps to 1', v = 1, 'stored ' || v);
end $$;

-- Leave the intake as it was found, so a re-run starts from the same
-- place and nothing downstream inherits this section's configuration.
do $$
declare v_intake uuid;
begin
  select intake_id into v_intake from public.applications
   where id = '44440000-0000-4000-8000-000000000004';
  update public.intake_documents set max_files = 4, visible = true
   where intake_id = v_intake and doc_type = 'qualification';
  update public.intake_documents set max_files = 2, visible = true
   where intake_id = v_intake and doc_type = 'other';
  delete from public.application_documents
   where application_id = '44440000-0000-4000-8000-000000000004';
end $$;

set role authenticated;


-- ---------------------------------------------------------------------
-- The bucket ceiling
--
-- This is the denial-of-service half. The catalogue trigger above only
-- governs rows in application_documents; an attacker who never bothers
-- to insert a catalogue row at all was previously free to put unbounded
-- 8 MB objects in the bucket.
--
-- Written through SQL rather than the Storage API, which is the same
-- RLS path the HTTP endpoint takes. If `authenticated` holds no INSERT
-- grant on storage.objects in this database the attempts raise
-- insufficient_privilege, which is reported as its own result rather
-- than being quietly counted as a pass.
-- ---------------------------------------------------------------------
do $$
declare
  v_app  uuid := '44440000-0000-4000-8000-000000000004';
  v_lim  smallint;
  n      int;
  i      int;
  v_last text := '';
begin
  raise notice ' ';
  raise notice '=== BUCKET CEILING ===';

  v_lim := app.doc_file_limit(v_app, 'id_document');

  -- A path with no folder segment. storage.foldername() returns an empty
  -- array here, and array_length() on an empty array is NULL, not 0 — the
  -- guard has to coalesce or this slips straight through.
  begin
    insert into storage.objects (bucket_id, name)
    values ('applicant-documents', 'loose-file.pdf');
    perform pg_temp.blocked('object at the bucket root', false, 'INSERT SUCCEEDED');
  exception
    when insufficient_privilege then
      perform pg_temp.blocked('object at the bucket root', true, 'no INSERT grant');
    when others then
      perform pg_temp.blocked('object at the bucket root', true);
  end;

  -- Someone else's folder.
  begin
    insert into storage.objects (bucket_id, name)
    values ('applicant-documents',
            '11110000-0000-4000-8000-000000000001/id_document/stolen.pdf');
    perform pg_temp.blocked('object in another applicant''s folder',
      false, 'INSERT SUCCEEDED');
  exception
    when insufficient_privilege then
      perform pg_temp.blocked('object in another applicant''s folder', true, 'no INSERT grant');
    when others then
      perform pg_temp.blocked('object in another applicant''s folder', true);
  end;

  -- A hidden doc type has a limit of 0, so its folder takes nothing at
  -- all — headroom must not create a slot where none was configured.
  begin
    insert into storage.objects (bucket_id, name)
    values ('applicant-documents', v_app || '/other/hidden.pdf');
    perform pg_temp.blocked('object under a hidden document type',
      false, 'INSERT SUCCEEDED');
  exception
    when insufficient_privilege then
      perform pg_temp.blocked('object under a hidden document type', true, 'no INSERT grant');
    when others then
      perform pg_temp.blocked('object under a hidden document type', true);
  end;

  -- Now the ceiling itself. Push well past it and see where it stops.
  -- The expected stopping point is max_files + 3: the headroom exists so
  -- a failed catalogue insert cannot permanently burn the slot for a
  -- required document. See part 3 of migration 015.
  for i in 1..40 loop
    begin
      insert into storage.objects (bucket_id, name)
      values ('applicant-documents', v_app || '/id_document/ddos-' || i || '.pdf');
    exception when others then
      v_last := sqlerrm;
      exit;
    end;
  end loop;

  select count(*) into n from storage.objects
   where bucket_id = 'applicant-documents'
     and left(name, length(v_app || '/id_document/')) = v_app || '/id_document/';

  perform pg_temp.blocked('flood one folder with objects',
    n <= v_lim + 3, 'stored=' || n || ' ceiling=' || (v_lim + 3));

  if n = 0 and v_last like '%permission denied%' then
    perform pg_temp.works('bucket ceiling exercised', false,
      'authenticated has no INSERT grant on storage.objects here — ' ||
      'the ceiling was NOT exercised, verify against the live project');
  end if;
end $$;

reset role;

-- No cleanup here on purpose. The shim reproduces Supabase's block on
-- DELETE FROM storage.objects, so these rows cannot be removed in SQL —
-- that is the whole reason storage_purge_queue exists. The harness
-- rebuilds the database on every run, so they go with it.

set role authenticated;


-- =====================================================================
-- As a REVIEWER scoped to one trade
-- =====================================================================
select set_config('test.uid', 'cccc3333-3333-4333-8333-333333333333', false);
select set_config('test.jwt', '{"email":"scoped@actom.co.za"}', false);

do $$
declare n int; v_other uuid;
begin
  raise notice ' ';
  raise notice '=== AS A TRADE-SCOPED REVIEWER ===';

  select id into v_other from public.applications
   where id = '22220000-0000-4000-8000-000000000002';

  select count(*) into n from public.applications
   where id = '22220000-0000-4000-8000-000000000002';
  perform pg_temp.blocked('see an application outside their trade', n = 0, 'rows=' || n);

  begin
    perform public.reveal_id_number('22220000-0000-4000-8000-000000000002',
                                    'checking identity for the file');
    perform pg_temp.blocked('reveal an ID outside their trade', false, 'RETURNED A VALUE');
  exception when others then
    perform pg_temp.blocked('reveal an ID outside their trade', true);
  end;

  -- A reviewer is not a manager
  begin
    perform public.enrol_applicant('11110000-0000-4000-8000-000000000001', current_date);
    perform pg_temp.blocked('enrol without being a manager', false, 'SUCCEEDED');
  exception when others then
    perform pg_temp.blocked('enrol without being a manager', true);
  end;

  begin
    perform public.publish_intake((select id from public.intakes limit 1));
    perform pg_temp.blocked('publish without being a manager', false, 'SUCCEEDED');
  exception when others then
    perform pg_temp.blocked('publish without being a manager', true);
  end;

  begin
    perform public.unenrol_apprentice(gen_random_uuid(), 'testing');
    perform pg_temp.blocked('remove someone from the register', false, 'SUCCEEDED');
  exception when others then
    perform pg_temp.blocked('remove someone from the register', true);
  end;

  -- A reveal with no reason
  begin
    perform public.reveal_id_number('11110000-0000-4000-8000-000000000001', '');
    perform pg_temp.blocked('reveal an ID with no reason', false, 'SUCCEEDED');
  exception when others then
    perform pg_temp.blocked('reveal an ID with no reason', true);
  end;
end $$;


-- =====================================================================
-- Injection attempts through RPC arguments
-- =====================================================================
do $$
declare v jsonb; n int;
begin
  raise notice ' ';
  raise notice '=== INJECTION THROUGH RPC ARGUMENTS ===';

  -- The reason string is stored and displayed; it must not execute.
  begin
    perform public.reveal_id_number('11110000-0000-4000-8000-000000000001',
      ''' ; drop table public.applications; --');
  exception when others then null;
  end;
  select count(*) into n from information_schema.tables
   where table_schema = 'public' and table_name = 'applications';
  perform pg_temp.blocked('SQL injection via the reveal reason', n = 1, 'table still present');

  -- SA ID validation must not be fooled into an error that leaks state.
  v := app.validate_sa_id(''' or 1=1 --');
  perform pg_temp.blocked('injection via the ID number argument',
    not (v->>'valid')::boolean, coalesce(v->>'reason',''));
end $$;

reset role;

\echo ''
\echo 'Adversarial run complete.'
\echo 'Every line should read BLOCKED or OK. A BREACH is an attack that'
\echo 'succeeded; a FAILED is a legitimate action the controls now refuse,'
\echo 'which locks a real applicant out and matters just as much.'
