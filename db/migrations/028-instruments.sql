-- ============================================================
--  ACTOM Grid — 028 instrument calibration register
--
--  ISO 9001:2015 clause 7.1.5 requires that measuring equipment be
--  calibrated at defined intervals, identified, safeguarded, and
--  that out-of-tolerance findings be recorded. This module replaces
--  the per-division spreadsheet (QA-REG-002 for MVS) with a live
--  register that tracks the same information and adds what the
--  spreadsheet cannot: a change history for every instrument, and
--  a workflow status that advances automatically as dates approach.
--
--  DESIGN DECISIONS
--
--  ONE TABLE PER INSTRUMENT, NOT PER CALIBRATION EVENT
--  The spreadsheet has one row per instrument. History lives in
--  calibrations (029). instruments is the master register.
--
--  STATUS IS DERIVED, NOT TYPED
--  The spreadsheet's "Filter" column (days to expiry) drives the
--  colour key. So does this module: calibration_status() is a
--  function that returns a bucket from the expiry date, the
--  instrument's active flag, and the latest calibration record's
--  workflow_stage. The UI never asks someone to type "Calibration
--  due within 3 months" — it reads from the date.
--
--  ACTIVE / INACTIVE
--  Instruments that are lost, broken, decommissioned, or not in
--  service are kept in the register with active = false. ISO 9001
--  requires records of equipment found to be unsuitable. Deleting
--  rows is not an option.
--
--  CALIBRATION TYPE
--  External instruments go to a calibration house; internal ones
--  are checked against a master reference in-house. Both paths are
--  tracked here. The delivery workflow (029) handles external only.
-- ============================================================

do $prereq$
begin
  if to_regclass('public.division_profile') is null then
    raise exception '028 needs 001-init-inspections.sql first.';
  end if;
end $prereq$;

-- ------------------------------------------------------------
--  1. Instrument locations (lookup table).
--
--  The spreadsheet has a free-text Location column. A lookup table
--  enforces consistency and lets the app offer a dropdown. Existing
--  free-text values can still be imported via a notes column.
-- ------------------------------------------------------------
create table if not exists instrument_locations (
  id   smallserial primary key,
  name text not null unique
);

insert into instrument_locations (name) values
  ('Quality Assurance'),
  ('Machine Shop'),
  ('Press Shop'),
  ('Breaker Assembly'),
  ('Indoor Assembly'),
  ('Outdoor Welding'),
  ('Sheet Metal Work'),
  ('Toolroom'),
  ('Stores'),
  ('Test'),
  ('Maintenance'),
  ('Mould Shop'),
  ('Vacuum Interrupters'),
  ('Minisub Assembly'),
  ('Paint Shop'),
  ('Aftersales Site'),
  ('Malaysia'),
  ('Other')
on conflict (name) do nothing;

alter table instrument_locations enable row level security;
revoke all on instrument_locations from anon, authenticated;
grant select on instrument_locations to authenticated;
create policy instrument_locations_read on instrument_locations for select using (auth.uid() is not null);

-- ------------------------------------------------------------
--  2. Calibration workflow stage.
--
--  These are the procurement/logistics states visible in the
--  spreadsheet. They are separate from the expiry-based status
--  computed by calibration_bucket() below. An instrument can be
--  "due within 3 months" (expiry bucket) and "purchase_order_stage"
--  (workflow stage) at the same time — the PO has been raised but
--  the expiry has not yet passed.
-- ------------------------------------------------------------
do $mktype$
begin
  if not exists (select 1 from pg_type where typname = 'cal_workflow_stage') then
    create type cal_workflow_stage as enum (
      'active',
      'quotation_stage',
      'requisition_stage',
      'purchase_order_stage',
      'sent_for_calibration',
      'on_hold',
      'faulty_equipment',
      'not_in_service'
    );
  end if;
end $mktype$;

-- ------------------------------------------------------------
--  3. Master instrument register.
-- ------------------------------------------------------------
create table if not exists instruments (
  id                  uuid primary key default gen_random_uuid(),
  serial_number       text not null,
  description         text not null,
  model               text,
  location_id         smallint references instrument_locations(id),
  location_other      text,    -- free text when location_id is null or 'Other'
  used_by             text,
  calibration_type    text not null default 'external'
                        check (calibration_type in ('internal','external')),
  workflow_stage      cal_workflow_stage not null default 'active',
  active              boolean not null default true,
  decommissioned_at   date,
  decommission_reason text
                        check (decommission_reason is null or decommission_reason in
                              ('lost','broken','scrapped','not_in_service','other')),
  imported_at         timestamptz,
  notes               text,
  created_by          uuid references profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Serial numbers need only be unique within a division database,
  -- which this already is (one Supabase project per division).
  unique (serial_number)
);

create index if not exists instruments_location_idx  on instruments (location_id);
create index if not exists instruments_active_idx    on instruments (active, workflow_stage);
create index if not exists instruments_serial_idx    on instruments (serial_number);

alter table instruments enable row level security;
revoke all on instruments from anon, authenticated;
grant select, insert, update on instruments to authenticated;

create policy instruments_read on instruments
  for select using (auth.uid() is not null);

create policy instruments_write on instruments
  for insert with check (created_by = auth.uid());

create policy instruments_update on instruments
  for update using (auth.uid() is not null);

-- Keep updated_at current automatically.
create or replace function touch_instrument()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_touch_instrument on instruments;
create trigger trg_touch_instrument
  before update on instruments
  for each row execute function touch_instrument();

-- ------------------------------------------------------------
--  4. Deactivation guard.
--
--  Decommissioning must record a reason and a date.
-- ------------------------------------------------------------
create or replace function fn_instrument_deactivate_check()
returns trigger language plpgsql as $$
begin
  if new.active = false and old.active = true then
    if new.decommissioned_at is null then
      raise exception 'INSTRUMENT_DEACTIVATE: set decommissioned_at when marking an instrument inactive.';
    end if;
    if new.decommission_reason is null then
      raise exception 'INSTRUMENT_DEACTIVATE: set decommission_reason when marking an instrument inactive.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_instrument_deactivate on instruments;
create trigger trg_instrument_deactivate
  before update on instruments
  for each row execute function fn_instrument_deactivate_check();

-- ------------------------------------------------------------
--  5. Expiry-bucket function.
--
--  Returns a text label matching the spreadsheet's colour key.
--  Called by v_instruments (029) and the dashboard summary (030).
--  Takes the expiry date and the current workflow stage so it can
--  short-circuit for instruments not in active service.
-- ------------------------------------------------------------
create or replace function calibration_bucket(
  p_expires_at      date,
  p_workflow_stage  cal_workflow_stage,
  p_active          boolean
) returns text language sql stable as $$
  select
    case
      when not p_active                          then 'not_in_service'
      when p_workflow_stage = 'faulty_equipment' then 'faulty_equipment'
      when p_workflow_stage = 'on_hold'          then 'on_hold'
      when p_workflow_stage = 'not_in_service'   then 'not_in_service'
      when p_expires_at is null                  then 'no_record'
      when p_expires_at < current_date           then 'overdue'
      when p_expires_at < current_date + 90      then 'due_90d'
      when p_expires_at < current_date + 180     then 'due_180d'
      when p_expires_at < current_date + 365     then 'due_365d'
      else                                            'valid'
    end
$$;

grant execute on function calibration_bucket(date, cal_workflow_stage, boolean) to authenticated;

-- ------------------------------------------------------------
--  6. Verification.
-- ------------------------------------------------------------
do $verify$
begin
  if to_regclass('public.instruments') is null then
    raise exception '028: instruments table was not created.';
  end if;
  if not exists (select 1 from pg_proc where proname = 'calibration_bucket') then
    raise exception '028: calibration_bucket function was not created.';
  end if;
  raise notice '028 applied. Instrument register and calibration_bucket() ready.';
end $verify$;
