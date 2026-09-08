-- =====================================================================
-- Clear applications, for testing
--
-- Deletes every application and everything hanging off it. Leaves the
-- catalogue, intake configuration, reviewers and consent wording alone,
-- so you can apply again immediately without re-running any setup.
--
-- =====================================================================
--  DO NOT RUN THIS ONCE REAL APPLICANTS HAVE APPLIED.
--
--  Submitted applications are records ACTOM is obliged to keep and to
--  delete on a schedule, not on a whim. Deleting them by hand loses the
--  evidence that retention was honoured, and there is no undo.
--
--  Uncomment the guard below in any environment that is not a sandbox.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Safety guard. Uncomment these five lines outside a test project.
-- ---------------------------------------------------------------------
-- do $$
-- begin
--   if current_database() not like '%test%' then
--     raise exception 'Refusing to run: % does not look like a test database.', current_database();
--   end if;
-- end $$;


-- ---------------------------------------------------------------------
-- What is about to go
-- ---------------------------------------------------------------------
select
  (select count(*) from public.applications)           as applications,
  (select count(*) from public.application_subjects)   as subject_marks,
  (select count(*) from public.application_documents)  as documents,
  (select count(*) from public.guardians)              as guardians,
  (select count(*) from public.consents)               as consents,
  (select count(*) from public.application_reviews)    as reviews;


-- ---------------------------------------------------------------------
-- Delete
--
-- NOTE ON FILES
--   Supabase forbids deleting from storage.objects in SQL — files must go
--   through the Storage API. So this clears the database only, and queues
--   the paths in storage_purge_queue. Empty the bucket afterwards:
--
--     Supabase dashboard -> Storage -> applicant-documents
--     -> select all -> Delete
--
--   Or let the purge worker drain the queue, if one is deployed.
--
-- application_subjects, application_documents, guardians, consents and
-- application_reviews are all ON DELETE CASCADE from applications, so
-- they clear themselves. They are listed explicitly anyway — a cascade
-- that has been altered later is a silent way to leave orphans behind.
-- ---------------------------------------------------------------------
do $$
declare v_files integer := 0; v_apps integer := 0;
begin
  -- Queue the files rather than deleting them: a direct delete raises
  -- and rolls back this whole block.
  insert into public.storage_purge_queue (bucket_id, storage_path, application_id, reason)
  select 'applicant-documents', d.storage_path, d.application_id, 'test_reset'
    from public.application_documents d
  on conflict do nothing;
  get diagnostics v_files = row_count;

  delete from public.application_reviews;
  delete from public.consents;
  delete from public.guardians;
  delete from public.application_documents;
  delete from public.application_subjects;

  delete from public.applications;
  get diagnostics v_apps = row_count;

  -- The audit log is append-only by design and is NOT cleared here: it
  -- is the record of who looked at what, and survives the data it
  -- describes. Uncomment only in a sandbox you are resetting fully.
  -- delete from public.pii_access_log;
  -- delete from public.application_events where application_id is not null;

  raise notice 'Deleted % application(s). % file(s) queued for removal — empty the bucket in the dashboard.', v_apps, v_files;
end $$;


-- ---------------------------------------------------------------------
-- Reset the reference number sequence, so the next test application is
-- ACT-APP-<year>-000001 again rather than continuing from where the
-- deleted ones left off.
-- ---------------------------------------------------------------------
alter sequence public.application_ref_seq restart with 1;


-- ---------------------------------------------------------------------
-- Confirm. All zero, and the configuration untouched.
-- ---------------------------------------------------------------------
select
  (select count(*) from public.applications)          as applications,
  (select count(*) from public.application_subjects)  as subject_marks,
  (select count(*) from public.application_documents) as documents,
  (select count(*) from public.trades)                as trades_kept,
  (select count(*) from public.subjects)              as subjects_kept,
  (select count(*) from public.intake_trade_subjects) as subject_rules_kept,
  (select count(*) from public.reviewer_profiles)     as reviewers_kept,
  (select count(*) from public.pii_access_log)        as audit_log_kept;


-- ---------------------------------------------------------------------
-- Applying again as the same person
--
-- One application per person per intake is enforced by a unique
-- constraint, and your auth.users row survives this script — so you can
-- sign in with the same address and start a fresh application straight
-- away. To test the sign-up path from scratch instead, delete the user:
--
--   delete from auth.users where email = 'you@example.com';
--
-- That cascades to the application, so run it INSTEAD of the above, not
-- as well.
-- ---------------------------------------------------------------------
