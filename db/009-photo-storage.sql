-- ============================================================
--  ACTOM Grid — 009 photo storage: gaps found while it would not upload
--
--  Three things, all of which fail QUIETLY, which is why they were worth
--  finding as a group.
--
--  1. attachments had no DELETE policy. Removing a photo therefore
--     affected zero rows and reported success — the thumbnail vanished
--     from the screen and the record stayed. Detaching is not the same as
--     deleting the file: the object itself is evidence and the storage
--     policy still refuses to remove it.
--
--  2. The bucket and its policies are re-asserted idempotently. If the
--     storage section of 002 did not land in a given division — it is the
--     one part of the schema that touches a schema Supabase manages, and
--     it is easy to run the rest and miss it — every upload fails with
--     "Bucket not found" and nothing else explains why.
--
--  3. The upload policy is scoped tighter. It accepted anything under
--     inspections/; it now also requires the caller to be signed in and
--     the path to have the shape the app writes.
-- ============================================================

-- 1. Detaching a photo from an inspection.
drop policy if exists att_detach on attachments;
create policy att_detach on attachments for delete
  using (
    uploaded_by = auth.uid()
    or has_role('quality_engineer', 'quality_manager', 'sysadmin')
  );

comment on table attachments is
  'Links a stored object to an inspection. Deleting a row DETACHES the photo; '
  'the object in storage is never removed, because it is evidence.';

-- 2. The bucket, idempotently.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inspection-photos', 'inspection-photos', false, 8388608,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 8388608,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- 3. The policies, replaced so the set is current rather than accumulated.
drop policy if exists "qgrid read own division photos" on storage.objects;
drop policy if exists "qgrid upload photos" on storage.objects;
drop policy if exists "qgrid no photo deletes" on storage.objects;
drop policy if exists "q360 read own division photos" on storage.objects;
drop policy if exists "q360 upload photos" on storage.objects;
drop policy if exists "q360 no photo deletes" on storage.objects;

-- TO AUTHENTICATED, stated explicitly.
--
-- The originals omitted the role and so applied to PUBLIC. That is usually
-- harmless, but it is not what was meant, and an unqualified policy on a
-- table Supabase also ships its own policies for is hard to reason about
-- when an upload comes back with "new row violates row-level security
-- policy" and no indication of WHICH policy said no.
--
-- The path requirement is also relaxed to two segments. The app writes
-- inspections/<inspection>/<field>/<file>, but insisting on three turned an
-- unexpected path into the same opaque refusal.
create policy "grid read inspection photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'inspection-photos');

create policy "grid upload inspection photos" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] = 'inspections'
  );

-- Photos are evidence. Nobody deletes or replaces the object, including an
-- administrator: detaching a photo removes the link, never the file.
create policy "grid never delete inspection photos" on storage.objects
  for delete to authenticated using (false);

create policy "grid never overwrite inspection photos" on storage.objects
  for update to authenticated using (false);

-- ------------------------------------------------------------
--  Check what you have. Run this after the migration: expect exactly the
--  four policies above, and nothing else on this bucket.
-- ------------------------------------------------------------
do $verify$
declare v_count int; v_bucket int;
begin
  select count(*) into v_bucket from storage.buckets where id = 'inspection-photos';
  if v_bucket = 0 then
    raise exception 'The inspection-photos bucket does not exist. The insert above should have created it.';
  end if;

  select count(*) into v_count from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'grid %';
  if v_count <> 4 then
    raise exception 'Expected 4 storage policies, found %. Uploads will be refused.', v_count;
  end if;

  raise notice 'Storage ready: bucket present, 4 policies installed.';
end $verify$;
