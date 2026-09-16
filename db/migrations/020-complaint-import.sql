-- ============================================================
--  ACTOM Grid — 020 what an honest import of the workbook needs
--
--  019 built the register on the principle that closure is evidenced
--  rather than asserted. The workbook being imported into it asserts
--  closure on 957 records and evidences it on 38.
--
--  Three ways to reconcile that, and only one is defensible.
--
--    Fabricate the dates — set closed_at to the call date, or to the
--    month term, or to anything at all. This is inventing evidence in a
--    quality record. It is not a shortcut, it is a falsification, and
--    the resulting median time to close would be a number somebody
--    eventually quotes to a customer.
--
--    Import them as open. 950 complaints resolved years ago would sit in
--    the open register forever, the module would be unusable from the
--    first day, and somebody would "tidy" them by closing them with
--    today's date — arriving back at fabrication by a longer route.
--
--    Record what is true: the workbook said this was closed and never
--    said when. That is `legacy_closed`, and it is deliberately not the
--    same state as `closed`. It cannot be counted in time-to-close,
--    because there is no time to count.
--
--  This is the whole reason the module exists, so the import must not be
--  the first thing to undermine it. The register will read "closed, date
--  not recorded" against 950 rows, and that is not untidy — it is the
--  finding, visible, for as long as it takes to stop mattering.
--
--  Also here: the workbook's people are names, not Grid users. CE and
--  Site Eng were filled on 97% and 90%, which is the accountability half
--  of that process working, and discarding them to satisfy a foreign key
--  would lose the best data in the file.
-- ============================================================

do $prereq$
begin
  if to_regclass('public.complaints') is null then
    raise exception '020 needs 019-customer-complaints.sql first (complaints is missing).';
  end if;
end $prereq$;

-- ------------------------------------------------------------
--  1. Columns the import needs.
-- ------------------------------------------------------------
alter table complaints
  add column if not exists legacy_closed  boolean not null default false,
  add column if not exists owner_name     text,
  add column if not exists legacy_defect  text,
  add column if not exists legacy_type    text,
  add column if not exists legacy_section text,
  add column if not exists imported_at    timestamptz;

comment on column complaints.legacy_closed is
  'The source workbook recorded this as closed and did not record when. '
  'NOT the same as closed: there is no date, so it cannot be counted in '
  'time-to-close. Only ever set by the import.';

comment on column complaints.owner_name is
  'The CE named in the workbook, who is not a Grid user. Used only when '
  'owner_id is null. Do not use for new complaints — assign a real person.';

comment on column complaints.legacy_type is
  'The complaint type exactly as typed in the workbook, kept beside the '
  'mapped type_id so a mapping that was wrong can be found later. The '
  'workbook held four spellings of "Technical / Quality", one a typo.';

-- A legacy closure and a real one are different facts and must not both
-- be set. If a row has a date, it is closed properly.
alter table complaints drop constraint if exists complaint_legacy_closure;
alter table complaints
  add constraint complaint_legacy_closure
  check (not (legacy_closed and closed_at is not null));

-- Only imported rows may carry it.
alter table complaints drop constraint if exists complaint_legacy_needs_import;
alter table complaints
  add constraint complaint_legacy_needs_import
  check (not legacy_closed or imported_at is not null);

-- ------------------------------------------------------------
--  1b. The type the workbook actually used.
--
--  019 seeded the List sheet's eleven, which split Technical / Quality
--  into Electrical and Mechanical. The DATA sheet does not make that
--  split: 189 of 221 typed complaints are plain "Technical / Quality",
--  and deciding retrospectively which were electrical would be guessing
--  at 189 records to make a mapping tidy.
--
--  So the flat type exists, and is INACTIVE: legacy rows map to it,
--  and the picker (which filters on active) does not offer it for new
--  complaints. History keeps its own vocabulary; new records use the
--  better one.
-- ------------------------------------------------------------
insert into complaint_types (name, sort, is_technical, active)
values ('Technical / Quality', 15, true, false)
on conflict (name) do nothing;

-- ------------------------------------------------------------
--  2. Status, extended.
--
--  A fourth state, because collapsing it into `closed` would put 950
--  undated records into the closure statistics and produce exactly the
--  false confidence the module was built to remove.
-- ------------------------------------------------------------
create or replace function complaint_status(c complaints)
returns text language sql immutable as $$
  select case
    when c.closed_at    is not null then 'closed'
    when c.legacy_closed            then 'legacy_closed'
    when c.responded_at is not null then 'in_progress'
    else 'open'
  end;
$$;

-- ------------------------------------------------------------
--  3. The view, rebuilt to carry it.
-- ------------------------------------------------------------
create or replace view v_complaints with (security_invoker = on) as
select c.id, c.ref, c.legacy_ref, c.customer, c.site, c.details,
       c.contract_number, c.delivery_date,
       complaint_status(c)                     as status,
       c.legacy_closed                         as legacy_closed,
       c.imported_at                           as imported_at,
       coalesce(s.name, c.legacy_section)      as section,
       coalesce(t.name, c.legacy_type)         as complaint_type,
       coalesce(t.is_technical, false)         as is_technical,
       coalesce(dc.description, c.legacy_defect) as defect_code,
       coalesce(ow.full_name, c.owner_name)    as owner,
       c.site_engineer                         as site_engineer,
       c.called_at, c.responded_at, c.closed_at,
       c.correction, c.closure_note,
       c.cost_material, c.cost_labour, c.cost_total,
       n.ref                                   as ncr_ref,
       c.ncr_id                                as ncr_id,
       rb.full_name                            as raised_by_name,
       round(extract(epoch from (c.responded_at - c.called_at)) / 3600.0, 1) as response_hours,
       (c.closed_at::date - c.called_at::date) as days_to_close,
       (current_date - c.called_at::date)      as age_days
  from complaints c
  left join complaint_sections s on s.id = c.section_id
  left join complaint_types t    on t.id = c.type_id
  left join defect_codes dc      on dc.id = c.defect_code_id
  left join profiles ow          on ow.id = c.owner_id
  left join profiles rb          on rb.id = c.raised_by
  left join ncrs n               on n.id = c.ncr_id;

grant select on v_complaints to authenticated;

-- ------------------------------------------------------------
--  4. The import entry point.
--
--  SECURITY DEFINER, and deliberately so: the import writes rows whose
--  raised_by is nobody in particular, which the complaint_raise policy
--  correctly refuses. Restricted to sysadmin, and it is the only way to
--  set legacy_closed.
--
--  A legacy ref that is already present is skipped rather than
--  duplicated, so the import can be run twice without doubling the
--  register — which somebody will do.
-- ------------------------------------------------------------
create or replace function import_complaint(
  p_legacy_ref text, p_customer text, p_details text,
  p_called date, p_section text, p_type text, p_defect text,
  p_owner_name text, p_site_engineer text, p_contract text,
  p_responded date default null, p_closed date default null,
  p_legacy_closed boolean default false,
  p_correction text default null,
  p_cost_material numeric default null, p_cost_labour numeric default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ref text; v_section smallint; v_type smallint; v_defect smallint;
begin
  if not has_role('sysadmin') then
    raise exception 'IMPORT_ROLE: only a System Administrator may import.';
  end if;

  if exists (select 1 from complaints where legacy_ref = p_legacy_ref) then
    return 'skipped: ' || p_legacy_ref;
  end if;

  select id into v_section from complaint_sections where lower(name) = lower(btrim(p_section));
  select id into v_type    from complaint_types    where lower(name) = lower(btrim(p_type));
  select id into v_defect  from defect_codes       where lower(description) = lower(btrim(p_defect));

  insert into complaints (
    ref, legacy_ref, customer, details, called_at,
    section_id, type_id, defect_code_id,
    legacy_section, legacy_type, legacy_defect,
    owner_name, site_engineer, contract_number,
    responded_at, closed_at, legacy_closed, correction,
    cost_material, cost_labour,
    raised_by, imported_at)
  values (
    next_ref('CC'), p_legacy_ref, btrim(p_customer), btrim(p_details),
    coalesce(p_called::timestamptz, now()),
    v_section, v_type, v_defect,
    nullif(btrim(coalesce(p_section,'')),''), nullif(btrim(coalesce(p_type,'')),''),
    nullif(btrim(coalesce(p_defect,'')),''),
    nullif(btrim(coalesce(p_owner_name,'')),''), nullif(btrim(coalesce(p_site_engineer,'')),''),
    nullif(btrim(coalesce(p_contract,'')),''),
    p_responded::timestamptz, p_closed::timestamptz,
    (p_legacy_closed and p_closed is null), nullif(btrim(coalesce(p_correction,'')),''),
    p_cost_material, p_cost_labour,
    auth.uid(), now())
  returning id, ref into v_id, v_ref;

  return 'imported: ' || p_legacy_ref || ' as ' || v_ref;
end $$;

revoke all on function import_complaint(text,text,text,date,text,text,text,text,text,text,date,date,boolean,text,numeric,numeric) from public, anon, authenticated;
grant execute on function import_complaint(text,text,text,date,text,text,text,text,text,text,date,date,boolean,text,numeric,numeric) to authenticated;

-- ------------------------------------------------------------
--  5. Verification.
-- ------------------------------------------------------------
do $verify$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'complaints' and column_name = 'legacy_closed') then
    raise exception 'legacy_closed was not added.';
  end if;
  raise notice '020 applied. Imported rows closed without a date will read "closed, date not recorded" and are excluded from time-to-close.';
end $verify$;
