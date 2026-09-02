-- =====================================================================
-- Migration 007 — enrolment and the apprentice register
--
-- Enrolling is not just another application status. Once someone is
-- taken on, their record stops being an application and becomes part of
-- an employment record:
--
--   * An application is deleted 12 months after the intake closes.
--   * An apprentice's record must be kept for the duration of the
--     contract and well beyond it — the trade certificate, the SETA
--     registration and the employment record all depend on it.
--
-- So enrolment sets legal_hold on the application. Without that the
-- retention job would delete the source record out from under the
-- register, and the first anyone would notice is a register full of
-- rows pointing at applications that no longer exist.
--
-- The register does NOT copy the applicant's identity. It references the
-- application, which already holds the encrypted ID number behind the
-- reveal-and-log path. Copying would mean two places to protect, two
-- places to purge, and two places to get wrong.
--
-- Run after 006-retention-storage-fix.sql. Idempotent.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 'enrolled' becomes a valid application status
-- ---------------------------------------------------------------------
alter table public.applications drop constraint if exists applications_status_check;
alter table public.applications add constraint applications_status_check
  check (status in ('draft','submitted','under_review','shortlisted',
                    'declined','withdrawn','enrolled'));


-- ---------------------------------------------------------------------
-- 2. The register
-- ---------------------------------------------------------------------
create table if not exists public.apprentices (
  id                 uuid primary key default gen_random_uuid(),

  -- One apprentice per application. The application is the identity
  -- record; this is the employment record built on top of it.
  application_id     uuid not null unique
                     references public.applications(id) on delete restrict,
  intake_id          uuid not null references public.intakes(id),
  trade_id           uuid not null references public.trades(id),

  -- Denormalised for the register view only. The authoritative name is
  -- on the application; this exists so the register still reads sensibly
  -- if a name is later corrected, and so the list does not need a join
  -- to the identity record to render.
  full_name          text not null,

  employee_number    text,
  seta_learner_number text,

  start_date         date not null,
  expected_end_date  date,
  contract_signed_on date,

  site               text,          -- where they are based
  supervisor         text,          -- mentoring artisan or foreman

  status             text not null default 'active'
                     check (status in ('active','completed','withdrawn','terminated','transferred')),
  ended_on           date,
  end_reason         text,

  trade_test_date    date,
  trade_test_result  text check (trade_test_result in ('passed','failed','pending')),

  notes              text,

  enrolled_by        uuid references auth.users(id),
  enrolled_at        timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- An apprenticeship that ended must say when and why.
  constraint apprentices_end_recorded check (
    status in ('active','completed')
    or (ended_on is not null and end_reason is not null)
  )
);

create index if not exists apprentices_status_idx on public.apprentices(status);
create index if not exists apprentices_trade_idx  on public.apprentices(trade_id);
create index if not exists apprentices_intake_idx on public.apprentices(intake_id);

create or replace function app_private.touch_apprentice()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists apprentices_touch on public.apprentices;
create trigger apprentices_touch before update on public.apprentices
  for each row execute function app_private.touch_apprentice();


-- ---------------------------------------------------------------------
-- 3. Enrol
--
-- Only from 'shortlisted': enrolment is the end of a review, not a
-- shortcut past it. Sets legal_hold so retention leaves the record
-- alone, and writes an audit entry — this is the moment a person is
-- taken on, and it should be attributable.
-- ---------------------------------------------------------------------
create or replace function public.enrol_applicant(
  p_application       uuid,
  p_start_date        date,
  p_employee_number   text default null,
  p_seta_number       text default null,
  p_site              text default null,
  p_supervisor        text default null,
  p_contract_signed   date default null,
  p_expected_end      date default null,
  p_notes             text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; v_id uuid; v_end date;
begin
  if app.reviewer_role() not in ('admin','manager') then
    raise exception 'Only a manager or administrator can enrol an apprentice.';
  end if;

  select * into a from public.applications where id = p_application;
  if a.id is null then raise exception 'Application not found.'; end if;

  if exists (select 1 from public.apprentices where application_id = p_application) then
    return jsonb_build_object('ok', false,
      'reason', 'This applicant is already on the register.');
  end if;

  if a.status <> 'shortlisted' then
    return jsonb_build_object('ok', false,
      'reason', 'Only a shortlisted applicant can be enrolled. This one is ' || a.status || '.');
  end if;

  if p_start_date is null then
    return jsonb_build_object('ok', false, 'reason', 'A start date is required.');
  end if;

  -- Apprenticeships run three years unless told otherwise.
  v_end := coalesce(p_expected_end, p_start_date + interval '3 years');

  insert into public.apprentices (
    application_id, intake_id, trade_id, full_name,
    employee_number, seta_learner_number,
    start_date, expected_end_date, contract_signed_on,
    site, supervisor, notes, enrolled_by)
  values (
    a.id, a.intake_id, a.trade_id, a.full_name,
    nullif(btrim(coalesce(p_employee_number,'')), ''),
    nullif(btrim(coalesce(p_seta_number,'')), ''),
    p_start_date, v_end, p_contract_signed,
    nullif(btrim(coalesce(p_site,'')), ''),
    nullif(btrim(coalesce(p_supervisor,'')), ''),
    nullif(btrim(coalesce(p_notes,'')), ''),
    auth.uid())
  returning id into v_id;

  -- The application becomes an employment record. legal_hold keeps the
  -- retention job away from it; purge_after is cleared so nothing later
  -- misreads it as due for deletion.
  update public.applications
     set status = 'enrolled', legal_hold = true, purge_after = null
   where id = a.id;

  insert into public.application_events
    (application_id, actor_id, event, from_status, to_status, detail)
  values (a.id, auth.uid(), 'enrolled', 'shortlisted', 'enrolled',
          jsonb_build_object('apprentice_id', v_id, 'start_date', p_start_date));

  insert into public.pii_access_log (actor_id, actor_email, application_id, action, detail)
  values (auth.uid(), auth.jwt() ->> 'email', a.id, 'enrol',
          'Enrolled as an apprentice, starting ' || p_start_date);

  return jsonb_build_object('ok', true, 'apprentice_id', v_id, 'expected_end', v_end);
end;
$$;
grant execute on function public.enrol_applicant(uuid, date, text, text, text, text, date, date, text)
  to authenticated;


-- ---------------------------------------------------------------------
-- 4. Update a register entry
-- ---------------------------------------------------------------------
create or replace function public.update_apprentice(
  p_id            uuid,
  p_status        text default null,
  p_ended_on      date default null,
  p_end_reason    text default null,
  p_trade_test_date date default null,
  p_trade_test_result text default null,
  p_employee_number text default null,
  p_seta_number   text default null,
  p_site          text default null,
  p_supervisor    text default null,
  p_notes         text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if app.reviewer_role() not in ('admin','manager') then
    raise exception 'Only a manager or administrator can change the register.';
  end if;

  select * into r from public.apprentices where id = p_id;
  if r.id is null then raise exception 'Not on the register.'; end if;

  if p_status is not null and p_status not in ('active','completed') then
    if p_ended_on is null or btrim(coalesce(p_end_reason,'')) = '' then
      return jsonb_build_object('ok', false,
        'reason', 'Ending an apprenticeship needs both a date and a reason.');
    end if;
  end if;

  update public.apprentices set
    status            = coalesce(p_status, status),
    ended_on          = coalesce(p_ended_on, ended_on),
    end_reason        = coalesce(nullif(btrim(coalesce(p_end_reason,'')),''), end_reason),
    trade_test_date   = coalesce(p_trade_test_date, trade_test_date),
    trade_test_result = coalesce(p_trade_test_result, trade_test_result),
    employee_number   = coalesce(nullif(btrim(coalesce(p_employee_number,'')),''), employee_number),
    seta_learner_number = coalesce(nullif(btrim(coalesce(p_seta_number,'')),''), seta_learner_number),
    site              = coalesce(nullif(btrim(coalesce(p_site,'')),''), site),
    supervisor        = coalesce(nullif(btrim(coalesce(p_supervisor,'')),''), supervisor),
    notes             = coalesce(nullif(btrim(coalesce(p_notes,'')),''), notes)
  where id = p_id;

  insert into public.application_events (application_id, actor_id, event, detail)
  values (r.application_id, auth.uid(), 'apprentice_updated',
          jsonb_build_object('apprentice_id', p_id, 'status', coalesce(p_status, r.status)));

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.update_apprentice(uuid, text, date, text, date, text, text, text, text, text, text)
  to authenticated;


-- ---------------------------------------------------------------------
-- 5. Removing someone from the register
--
-- Deliberately restricted to admin, and it releases the legal hold so
-- the application returns to the normal retention path. Used when
-- someone was enrolled in error, not when they leave — leaving is a
-- status change, and the record stays.
-- ---------------------------------------------------------------------
create or replace function public.unenrol_apprentice(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; v_close timestamptz; v_months smallint;
begin
  if app.reviewer_role() <> 'admin' then
    raise exception 'Only an administrator can remove someone from the register.';
  end if;
  if btrim(coalesce(p_reason,'')) = '' then
    raise exception 'A reason is required.';
  end if;

  select * into r from public.apprentices where id = p_id;
  if r.id is null then raise exception 'Not on the register.'; end if;

  delete from public.apprentices where id = p_id;

  select i.closes_at, i.retention_months into v_close, v_months
    from public.intakes i where i.id = r.intake_id;

  update public.applications
     set status = 'shortlisted', legal_hold = false,
         purge_after = (v_close + (coalesce(v_months,12) || ' months')::interval)::date
   where id = r.application_id;

  insert into public.application_events (application_id, actor_id, event, detail)
  values (r.application_id, auth.uid(), 'unenrolled',
          jsonb_build_object('reason', btrim(p_reason)));
end;
$$;
grant execute on function public.unenrol_apprentice(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- 6. The register view
--
-- Joins in the trade and intake names so the console does not need to,
-- and exposes nothing from the application beyond what a register needs.
-- No ID number, encrypted or otherwise.
-- ---------------------------------------------------------------------
create or replace view public.v_apprentice_register as
select
  ap.id, ap.application_id, ap.full_name,
  ap.employee_number, ap.seta_learner_number,
  t.name  as trade, t.division,
  i.name  as intake,
  ap.start_date, ap.expected_end_date, ap.contract_signed_on,
  ap.site, ap.supervisor,
  ap.status, ap.ended_on, ap.end_reason,
  ap.trade_test_date, ap.trade_test_result,
  ap.notes, ap.enrolled_at,
  a.reference,
  a.contact_number, a.email,
  case
    when ap.status <> 'active' then null
    when ap.expected_end_date is null then null
    else greatest(0, (ap.expected_end_date - current_date))
  end as days_remaining,
  case
    when ap.expected_end_date is null or ap.start_date is null then null
    else least(100, greatest(0, round(
      (current_date - ap.start_date)::numeric
      / nullif((ap.expected_end_date - ap.start_date), 0) * 100)))
  end as progress_pct
from public.apprentices ap
  join public.trades   t on t.id = ap.trade_id
  join public.intakes  i on i.id = ap.intake_id
  join public.applications a on a.id = ap.application_id;

grant select on public.v_apprentice_register to authenticated;


-- ---------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------
alter table public.apprentices enable row level security;

drop policy if exists apprentices_read on public.apprentices;
create policy apprentices_read on public.apprentices for select
  using (app.is_reviewer() and app.can_see_trade(trade_id));

-- Writes go through the RPCs above, which check the role. No direct
-- insert or update policy, deliberately.
grant select on public.apprentices to authenticated;


-- ---------------------------------------------------------------------
-- 8. Retention must never touch an enrolled record
--
-- Belt and braces on top of legal_hold: an explicit exclusion, so a
-- future change that clears legal_hold by accident still cannot delete
-- someone who is on the register.
-- ---------------------------------------------------------------------
create or replace function app_private.purge_expired()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer := 0; r record;
begin
  for r in
    select id from public.applications
     where legal_hold = false
       and status <> 'enrolled'
       and not exists (select 1 from public.apprentices ap where ap.application_id = id)
       and purge_after is not null and purge_after < current_date
  loop
    insert into public.storage_purge_queue (bucket_id, storage_path, application_id, reason)
    select 'applicant-documents', d.storage_path, d.application_id, 'retention'
      from public.application_documents d
     where d.application_id = r.id
    on conflict do nothing;

    delete from public.applications where id = r.id;
    v_count := v_count + 1;
  end loop;

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

  delete from public.pii_access_log where occurred_at < now() - interval '3 years';

  insert into public.application_events (event, detail)
  values ('retention_purge', jsonb_build_object(
            'applications_deleted', v_count,
            'files_queued', (select count(*) from public.storage_purge_queue
                              where deleted_at is null)));

  return v_count;
end;
$$;
