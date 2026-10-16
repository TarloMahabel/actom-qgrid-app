-- ============================================================
--  ACTOM Grid — 026 complaint form capture
--
--  Migration 025 added `customer_care` as a template module,
--  giving the form designer first-class support for CC templates.
--  This migration connects a logged complaint to a specific
--  template revision and adds a table to store field-level
--  answers — so the designed form drives the customer care
--  instead of the static QA-FM-005 HTML layout.
--
--  WHAT CHANGES
--
--  1. complaints.template_rev_id (nullable FK → template_revisions)
--     Links a complaint to the revision it was filled against.
--     NULL for complaints logged before this migration or without
--     a designed form — the static QA-FM-005 remains the fallback.
--
--  2. complaint_results table
--     One row per (complaint, field). Same shape as
--     inspection_results but keyed to complaint_id. RLS lets any
--     authenticated user read and write, locked once the complaint
--     is closed (same as the rest of the complaints module).
--
--  3. v_complaints is recreated to carry template_rev_id through
--     to the app so the Form button knows which path to take.
--
--  4. raise_complaint is replaced with a 10-parameter version that
--     accepts p_template_rev_id. The old 9-parameter version is
--     dropped to keep the function namespace clean.
-- ============================================================

do $prereq$ begin
  if to_regclass('public.complaints') is null then
    raise exception '026 needs 019-customer-complaints.sql first.';
  end if;
  if to_regclass('public.template_revisions') is null then
    raise exception '026 needs 001-init-inspections.sql first.';
  end if;
end $prereq$;

-- ------------------------------------------------------------
--  1. Link complaints to a template revision.
-- ------------------------------------------------------------
alter table complaints
  add column if not exists template_rev_id uuid references template_revisions(id);

comment on column complaints.template_rev_id is
  'The published CC template revision used when capturing this complaint. '
  'NULL for complaints logged before this migration, or logged without a '
  'designed form. Answers are stored in complaint_results.';

-- ------------------------------------------------------------
--  2. Field-level answers.
-- ------------------------------------------------------------
create table if not exists complaint_results (
  id           uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references complaints(id) on delete cascade,
  field_id     uuid not null,
  label        text,
  outcome      text,
  value_text   text,
  value_num    numeric,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references profiles(id),
  unique (complaint_id, field_id)
);

create index if not exists complaint_results_complaint_idx
  on complaint_results (complaint_id);

comment on table complaint_results is
  'Field-level answers for complaint forms designed in the Form Designer. '
  'Mirrors inspection_results but keyed to complaint_id. Rows are locked '
  'once the parent complaint is closed (enforced by RLS policy).';

alter table complaint_results enable row level security;
revoke all on complaint_results from anon, authenticated;
grant select, insert, update on complaint_results to authenticated;

create policy complaint_results_read on complaint_results
  for select using (auth.uid() is not null);

create policy complaint_results_write on complaint_results
  for insert with check (
    updated_by = auth.uid() and
    exists (select 1 from complaints c
             where c.id = complaint_id and c.closed_at is null)
  );

create policy complaint_results_update on complaint_results
  for update using (
    exists (select 1 from complaints c
             where c.id = complaint_id and c.closed_at is null)
  );

-- ------------------------------------------------------------
--  3. Rebuild v_complaints with template_rev_id.
--
--  PostgreSQL's CREATE OR REPLACE VIEW does not allow reordering
--  existing columns — adding a new column in the middle would cause
--  "cannot change name of view column" errors on existing databases.
--  We drop and recreate so template_rev_id can be appended last.
-- ------------------------------------------------------------
drop view if exists v_complaints;

create view v_complaints with (security_invoker = on) as
select c.id, c.ref, c.legacy_ref, c.customer, c.company_name, c.site, c.details,
       c.contact_person, c.contact_tel, c.contracts_engineer,
       c.contract_number, c.delivery_date,
       c.date_received, c.date_delivered, c.date_installed,
       complaint_status(c)                       as status,
       c.legacy_closed, c.imported_at,
       c.severity::text                          as severity,
       coalesce(s.name, c.legacy_section)        as section,
       coalesce(t.name, c.legacy_type)           as complaint_type,
       coalesce(t.is_technical, false)           as is_technical,
       coalesce(dc.description, c.legacy_defect) as defect_code,
       coalesce(ow.full_name, c.owner_name)      as owner,
       c.site_engineer,
       c.called_at, c.responded_at, c.closed_at,
       c.correction, c.closure_note,
       c.why_chain, c.root_cause_text, c.cause_completed,
       c.containment_kind, c.containment_note, c.preventive_action,
       c.coordinator_name, c.coordinator_at, c.ceo_name, c.ceo_at,
       c.cleared_name, c.cleared_at,
       c.cost_estimated, c.cost_material, c.cost_labour, c.cost_other,
       c.cost_total, c.cost_charged_to,
       n.ref                                     as ncr_ref,
       c.ncr_id,
       rb.full_name                              as raised_by_name,
       (select count(*) from complaint_documents d
         where d.complaint_id = c.id)            as documents,
       round(extract(epoch from
         (c.responded_at - c.called_at)) / 3600.0, 1) as response_hours,
       round(extract(epoch from
         (c.responded_at - c.called_at)) / 86400.0, 1) as response_days,
       (c.closed_at::date - c.called_at::date)   as days_to_close,
       (current_date - c.called_at::date)        as age_days,
       c.template_rev_id
  from complaints c
  left join complaint_sections s  on s.id = c.section_id
  left join complaint_types t     on t.id = c.type_id
  left join defect_codes dc       on dc.id = c.defect_code_id
  left join profiles ow           on ow.id = c.owner_id
  left join profiles rb           on rb.id = c.raised_by
  left join ncrs n                on n.id = c.ncr_id;

grant select on v_complaints to authenticated;

-- ------------------------------------------------------------
--  4. Replace raise_complaint.
--
--  The old 9-parameter version is dropped; the new one takes
--  p_template_rev_id with a default of null so existing callers
--  that omit the parameter continue to work without changes.
-- ------------------------------------------------------------
drop function if exists raise_complaint(
  text, text, smallint, smallint, text, smallint, uuid, text, text);

create or replace function raise_complaint(
  p_customer        text,
  p_details         text,
  p_section         smallint,
  p_type            smallint,
  p_site            text    default null,
  p_defect_code     smallint default null,
  p_owner           uuid    default null,
  p_site_engineer   text    default null,
  p_contract        text    default null,
  p_template_rev_id uuid    default null
) returns complaints language plpgsql security invoker as $$
declare c complaints;
begin
  if coalesce(btrim(p_customer), '') = '' then
    raise exception 'COMPLAINT_CUSTOMER: a complaint needs a customer.';
  end if;
  if coalesce(btrim(p_details), '') = '' then
    raise exception 'COMPLAINT_DETAILS: a complaint needs to say what the customer reported.';
  end if;

  insert into complaints (
    ref, customer, details, section_id, type_id, site,
    defect_code_id, owner_id, site_engineer, contract_number,
    template_rev_id, raised_by
  ) values (
    next_ref('CC'), btrim(p_customer), btrim(p_details),
    p_section, p_type,
    nullif(btrim(coalesce(p_site, '')), ''),
    p_defect_code,
    coalesce(p_owner, auth.uid()),
    nullif(btrim(coalesce(p_site_engineer, '')), ''),
    nullif(btrim(coalesce(p_contract, '')), ''),
    p_template_rev_id,
    auth.uid()
  ) returning * into c;
  return c;
end $$;

grant execute on function raise_complaint(
  text, text, smallint, smallint, text, smallint, uuid, text, text, uuid
) to authenticated;

-- ------------------------------------------------------------
--  5. Verification.
-- ------------------------------------------------------------
do $verify$ begin
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'complaints' and column_name = 'template_rev_id'
  ) then
    raise exception '026: template_rev_id was not added to complaints.';
  end if;
  if to_regclass('public.complaint_results') is null then
    raise exception '026: complaint_results was not created.';
  end if;
  raise notice '026 applied. Complaints can now be linked to a designed CC template form.';
end $verify$;
