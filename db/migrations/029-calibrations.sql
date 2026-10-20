-- ============================================================
--  ACTOM Grid — 029 calibration records, deliveries and v_instruments
--
--  029 builds on 028 (instruments). Each calibration event is one
--  row in calibrations. The current calibration is the row with the
--  latest calibrated_at for that instrument. v_instruments joins
--  them and computes the live expiry bucket.
--
--  DELIVERY TRACKING
--  When an instrument goes to an external calibration house the
--  logistics are tracked in calibration_deliveries: PO number,
--  calibration house, sent date, expected and actual return dates.
--  One instrument can have multiple deliveries over its life.
--
--  CERTIFICATES
--  The certificate reference number is recorded on the calibration
--  row. PDF files upload to the calibration-certs storage bucket
--  and are linked via calibration_documents, same pattern as
--  complaint_documents in 021.
-- ============================================================

do $prereq$
begin
  if to_regclass('public.instruments') is null then
    raise exception '029 needs 028-instruments.sql first.';
  end if;
end $prereq$;

-- ------------------------------------------------------------
--  1. Calibration history.
-- ------------------------------------------------------------
create table if not exists calibrations (
  id               uuid primary key default gen_random_uuid(),
  instrument_id    uuid not null references instruments(id) on delete cascade,
  calibrated_at    date not null,
  expires_at       date not null,
  certificate_ref  text,
  calibration_house text,        -- external lab name; null for internal
  calibrated_by    text,         -- person/name for internal calibration
  comment          text,
  created_by       uuid references profiles(id),
  created_at       timestamptz not null default now(),
  constraint cal_dates_ok check (expires_at > calibrated_at)
);

create index if not exists calibrations_instrument_idx on calibrations (instrument_id, calibrated_at desc);

alter table calibrations enable row level security;
revoke all on calibrations from anon, authenticated;
grant select, insert on calibrations to authenticated;

create policy calibrations_read on calibrations
  for select using (auth.uid() is not null);

create policy calibrations_write on calibrations
  for insert with check (created_by = auth.uid());

-- ------------------------------------------------------------
--  2. Delivery tracking.
-- ------------------------------------------------------------
create table if not exists calibration_deliveries (
  id                uuid primary key default gen_random_uuid(),
  instrument_id     uuid not null references instruments(id) on delete cascade,
  po_number         text,
  calibration_house text,
  sent_at           date,
  expected_return   date,
  returned_at       date,
  notes             text,
  created_by        uuid references profiles(id),
  created_at        timestamptz not null default now()
);

create index if not exists cal_deliveries_instrument_idx on calibration_deliveries (instrument_id, sent_at desc);

alter table calibration_deliveries enable row level security;
revoke all on calibration_deliveries from anon, authenticated;
grant select, insert, update on calibration_deliveries to authenticated;

create policy cal_deliveries_read on calibration_deliveries
  for select using (auth.uid() is not null);

create policy cal_deliveries_write on calibration_deliveries
  for insert with check (created_by = auth.uid());

create policy cal_deliveries_update on calibration_deliveries
  for update using (auth.uid() is not null);

-- ------------------------------------------------------------
--  3. Certificate documents (PDF storage).
-- ------------------------------------------------------------
create table if not exists calibration_documents (
  id              uuid primary key default gen_random_uuid(),
  calibration_id  uuid not null references calibrations(id) on delete cascade,
  storage_path    text not null,
  filename        text not null,
  bytes           integer,
  uploaded_by     uuid not null references profiles(id),
  uploaded_at     timestamptz not null default now()
);

create index if not exists cal_docs_cal_idx on calibration_documents (calibration_id);

alter table calibration_documents enable row level security;
revoke all on calibration_documents from anon, authenticated;
grant select, insert on calibration_documents to authenticated;

create policy cal_docs_read on calibration_documents
  for select using (auth.uid() is not null);

create policy cal_docs_write on calibration_documents
  for insert with check (uploaded_by = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('calibration-certs', 'calibration-certs', false, 15728640,
        array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update
  set file_size_limit    = 15728640,
      allowed_mime_types = array['application/pdf','image/jpeg','image/png'];

drop policy if exists "cal certs read"  on storage.objects;
create policy "cal certs read"  on storage.objects for select to authenticated
  using (bucket_id = 'calibration-certs');

drop policy if exists "cal certs write" on storage.objects;
create policy "cal certs write" on storage.objects for insert to authenticated
  with check (bucket_id = 'calibration-certs');

-- ------------------------------------------------------------
--  4. v_instruments — current status per instrument.
--
--  Joins each instrument with its most recent calibration record.
--  Computes days_to_expiry and the expiry bucket. This is the
--  primary view the calibration register and dashboard consume.
-- ------------------------------------------------------------
create or replace view v_instruments with (security_invoker = on) as
select
  i.id,
  i.serial_number,
  i.description,
  i.model,
  coalesce(il.name, i.location_other)         as location,
  i.location_id,
  i.location_other,
  i.used_by,
  i.calibration_type,
  i.workflow_stage::text                      as workflow_stage,
  i.active,
  i.decommissioned_at,
  i.decommission_reason,
  i.notes,
  i.created_at,
  i.updated_at,

  -- Latest calibration record
  c.id                                        as calibration_id,
  c.calibrated_at,
  c.expires_at,
  c.certificate_ref,
  c.calibration_house,
  c.calibrated_by,
  c.comment                                   as calibration_comment,

  -- Latest open delivery (sent but not returned)
  d.id                                        as delivery_id,
  d.po_number,
  d.sent_at,
  d.expected_return,

  -- Computed
  (c.expires_at - current_date)               as days_to_expiry,
  calibration_bucket(c.expires_at, i.workflow_stage, i.active) as bucket,

  -- Document count for current calibration
  (select count(*) from calibration_documents cd
    where cd.calibration_id = c.id)           as certificate_count

from instruments i
left join instrument_locations il on il.id = i.location_id
left join lateral (
  select * from calibrations
   where instrument_id = i.id
   order by calibrated_at desc
   limit 1
) c on true
left join lateral (
  select * from calibration_deliveries
   where instrument_id = i.id
     and returned_at is null
   order by sent_at desc
   limit 1
) d on true;

grant select on v_instruments to authenticated;

-- ------------------------------------------------------------
--  5. Verification.
-- ------------------------------------------------------------
do $verify$
begin
  if to_regclass('public.calibrations') is null then
    raise exception '029: calibrations table was not created.';
  end if;
  if to_regclass('public.v_instruments') is null then
    raise exception '029: v_instruments view was not created.';
  end if;
  raise notice '029 applied. calibrations, calibration_deliveries, v_instruments ready.';
end $verify$;
