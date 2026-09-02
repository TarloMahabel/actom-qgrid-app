-- ============================================================
--  ACTOM Grid — 011 who cleared a fault, and who verified it
--
--  Two more facts per fault line. They are people, not free text, so
--  they reference profiles: "cleared by J. Dlamini" has to mean the
--  J. Dlamini with an account, or the column is a comment box.
--
--  The timestamps are set by a trigger rather than by the browser. A
--  date typed on a tablet is a date somebody typed; a date the database
--  wrote when the field changed is evidence.
--
--  NOTE ON TIMING, worth knowing before these are used. A fault is found
--  at inspection; it is cleared later, on the floor; it is verified later
--  still. So these two columns are usually filled in AFTER the inspection
--  has been signed — which is why they are also editable from the Failed
--  checks queue, not only on the capture form. A signed inspection locks
--  its ANSWERS; a fault's progress has to keep moving or the record can
--  never show the fault was resolved.
-- ============================================================

alter table failed_checks
  add column if not exists cleared_by   uuid references profiles(id),
  add column if not exists cleared_at   timestamptz,
  add column if not exists verified_by  uuid references profiles(id),
  add column if not exists verified_at  timestamptz;

comment on column failed_checks.cleared_by is
  'Who did the work that put the fault right.';
comment on column failed_checks.verified_by is
  'Who checked the work afterwards. Independent verification is the point, '
  'so the same person doing both is recorded and shown, not silently accepted.';

-- Timestamps written by the database, not sent by the client.
create or replace function stamp_fault_progress()
returns trigger language plpgsql as $$
begin
  if new.cleared_by is distinct from old.cleared_by then
    new.cleared_at := case when new.cleared_by is null then null else now() end;
  end if;
  if new.verified_by is distinct from old.verified_by then
    new.verified_at := case when new.verified_by is null then null else now() end;
  end if;

  -- Verification is a check ON the clearing. Recording it before there is
  -- anything to check is an ordering mistake, not a preference.
  if new.verified_by is not null and new.cleared_by is null then
    raise exception 'FAULT_ORDER: record who cleared the fault before recording who verified it';
  end if;

  return new;
end $$;

drop trigger if exists trg_fault_progress on failed_checks;
create trigger trg_fault_progress
  before update on failed_checks
  for each row execute function stamp_fault_progress();

-- A fault that is cleared and verified is closed. Kept as a view so the
-- Failed checks queue and any later report agree on what "outstanding" means.
create or replace view v_fault_status with (security_invoker = on) as
select f.*,
       c.full_name as cleared_by_name,
       v.full_name as verified_by_name,
       case
         when f.verified_by is not null then 'verified'
         when f.cleared_by  is not null then 'cleared, awaiting verification'
         else 'outstanding'
       end as progress,
       (f.cleared_by is not null and f.cleared_by = f.verified_by) as self_verified
  from failed_checks f
  left join profiles c on c.id = f.cleared_by
  left join profiles v on v.id = f.verified_by;

grant select on v_fault_status to authenticated;

-- Clearing and verifying continue after the inspection is signed, so the
-- update policy cannot be tied to an open inspection.
drop policy if exists fc_progress on failed_checks;
create policy fc_progress on failed_checks for update
  using (
    has_role('inspector', 'supervisor', 'quality_engineer', 'quality_manager', 'sysadmin')
  )
  with check (true);
