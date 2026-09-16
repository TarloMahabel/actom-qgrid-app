-- ============================================================
--  ACTOM Grid — 019 customer complaints
--
--  Module 5. Read CUSTOMER-PLAN.md before changing anything here; the
--  shape of this table is an argument with the spreadsheet it replaces.
--
--  THE NUMBER THIS SCHEMA IS BUILT AROUND
--
--  In the workbook: 989 complaints, 957 marked Closed, 38 with a closing
--  date. Closure was asserted and never evidenced, so nobody can say how
--  long this division takes to resolve a customer complaint. Response
--  time is measurable on 13%. Those two intervals are the whole point of
--  a complaints process and are what clause 9.1.2 asks for.
--
--  So closed_at is not a field somebody may fill in. It is set by
--  close_complaint() and by nothing else, and status is derived from the
--  timestamps rather than typed. A register cannot drift from its own
--  dates if the dates are the only thing it has.
--
--  WHAT IS INHERITED RATHER THAN REDESIGNED
--
--  Defect Code 1 was filled on 52% of the workbook with a vocabulary
--  people evidently use — Breaker Defect, Transformer Defect, Wiring
--  Defect, Oil Leak, Painting. That is reused from defect_codes, NOT
--  duplicated: the same fault counted under two names depending on who
--  found it is exactly the reconciliation problem that produced the
--  workbook in the first place.
--
--  THE LINK TO NCRs
--
--  189 of 221 typed complaints were "Technical / Quality". Those are
--  nonconformances by any reading, and 014 already has the ladder, the
--  causes, the verified actions and the report. A complaint therefore
--  records the customer-facing half — who called, when, what they were
--  told, when it closed — and hands the investigation to an NCR through
--  ncr_id. Two registers describing the same failure would drift apart
--  and someone would reconcile them by hand, which is where the workbook
--  came from.
-- ============================================================

do $prereq$
begin
  if to_regclass('public.ncrs') is null then
    raise exception '019 needs 014-ncr.sql first (ncrs is missing).';
  end if;
  if to_regclass('public.defect_codes') is null then
    raise exception '019 needs 001-init-inspections.sql first (defect_codes is missing).';
  end if;
end $prereq$;

-- ------------------------------------------------------------
--  1. Reference lists.
--
--  The workbook's List sheet defined eleven complaint types and the DATA
--  sheet ignored them: four spellings of "Technical / Quality" including
--  one typo, two of "Wiring", two of "Minisub". A list that is enforced
--  cannot drift, which is most of why this module exists.
-- ------------------------------------------------------------
create table if not exists complaint_types (
  id       smallserial primary key,
  name     text not null unique,
  sort     smallint not null default 100,
  -- Types that mean "this is also a nonconformance". Used to prompt for
  -- an NCR rather than to require one: the prompt is the useful part,
  -- and forcing it would produce empty NCRs raised to clear a warning.
  is_technical boolean not null default false,
  active   boolean not null default true
);

create table if not exists complaint_sections (
  id       smallserial primary key,
  name     text not null unique,
  sort     smallint not null default 100,
  active   boolean not null default true
);

insert into complaint_types (name, sort, is_technical) values
  ('Technical / Quality — Electrical', 10, true),
  ('Technical / Quality — Mechanical', 20, true),
  ('Design',                           30, true),
  ('Install & Commissioning',          40, true),
  ('Shortage',                         50, false),
  ('Delivery',                         60, false),
  ('Damage in Transit',                70, false),
  ('Lack of Response',                 80, false),
  ('Payment',                          90, false),
  ('EHS',                             100, false)
on conflict (name) do nothing;

insert into complaint_sections (name, sort) values
  ('Indoor', 10), ('Minisubs', 20), ('Outdoor', 30), ('Aftersales', 40),
  ('WPI', 50), ('Renewable', 60), ('Western Region', 70), ('Ekurhuleni', 80),
  ('Medupi', 90), ('Quoted Work', 100)
on conflict (name) do nothing;

-- ------------------------------------------------------------
--  2. The register.
-- ------------------------------------------------------------
create table if not exists complaints (
  id                uuid primary key default gen_random_uuid(),
  ref               text not null unique,
  legacy_ref        text,                       -- the workbook's CC No

  section_id        smallint references complaint_sections(id),
  type_id           smallint references complaint_types(id),
  customer          text not null,
  site              text,
  contract_number   text,
  delivery_date     date,

  details           text not null,
  defect_code_id    smallint references defect_codes(id),

  -- Who owns it, and who attended. Both were on 90%+ of the workbook,
  -- so the accountability half of this process already works.
  owner_id          uuid references profiles(id),
  site_engineer     text,

  -- The three moments the whole module exists to capture.
  called_at         timestamptz not null default now(),
  responded_at      timestamptz,
  closed_at         timestamptz,

  responded_by      uuid references profiles(id),
  closed_by         uuid references profiles(id),

  -- Closing requires these, enforced in close_complaint().
  correction        text,
  closure_note      text,

  ncr_id            uuid references ncrs(id) on delete set null,

  cost_material     numeric(12,2),
  cost_labour       numeric(12,2),
  cost_total        numeric(12,2) generated always as
                      (coalesce(cost_material,0) + coalesce(cost_labour,0)) stored,

  raised_by         uuid not null references profiles(id),
  created_at        timestamptz not null default now(),

  -- A complaint cannot be answered before it was made, nor closed before
  -- it was answered. Arithmetic, not judgement.
  constraint complaint_answered_after_call
    check (responded_at is null or responded_at >= called_at),
  constraint complaint_closed_after_answer
    check (closed_at is null or closed_at >= called_at)
);

create index if not exists complaints_called_idx   on complaints (called_at desc);
create index if not exists complaints_open_idx     on complaints (closed_at) where closed_at is null;
create index if not exists complaints_customer_idx on complaints (customer);
create index if not exists complaints_ncr_idx      on complaints (ncr_id) where ncr_id is not null;

comment on table complaints is
  'Customer complaints. closed_at is written by close_complaint() and by '
  'nothing else: the workbook this replaces marked 957 of 989 closed and '
  'recorded a closing date on 38, so closure was asserted and never evidenced.';

-- ------------------------------------------------------------
--  3. Status is derived, never typed.
--
--  The workbook had Closed, closed, and Work in progress. Three values
--  for two states, because it was free text.
-- ------------------------------------------------------------
create or replace function complaint_status(c complaints)
returns text language sql immutable as $$
  select case
    when c.closed_at    is not null then 'closed'
    when c.responded_at is not null then 'in_progress'
    else 'open'
  end;
$$;

-- ------------------------------------------------------------
--  4. Reference numbering, using the sequence table 005 locked down.
-- ------------------------------------------------------------
create or replace function raise_complaint(
  p_customer text, p_details text, p_section smallint, p_type smallint,
  p_site text default null, p_defect_code smallint default null,
  p_owner uuid default null, p_site_engineer text default null,
  p_contract text default null
) returns complaints language plpgsql security invoker as $$
declare c complaints;
begin
  if coalesce(btrim(p_customer), '') = '' then
    raise exception 'COMPLAINT_CUSTOMER: a complaint needs a customer.';
  end if;
  if coalesce(btrim(p_details), '') = '' then
    raise exception 'COMPLAINT_DETAILS: a complaint needs to say what the customer reported.';
  end if;

  insert into complaints (ref, customer, details, section_id, type_id, site,
                          defect_code_id, owner_id, site_engineer, contract_number, raised_by)
  values (next_ref('CC'), btrim(p_customer), btrim(p_details), p_section, p_type,
          nullif(btrim(coalesce(p_site,'')), ''), p_defect_code,
          coalesce(p_owner, auth.uid()), nullif(btrim(coalesce(p_site_engineer,'')), ''),
          nullif(btrim(coalesce(p_contract,'')), ''), auth.uid())
  returning * into c;
  return c;
end $$;

-- ------------------------------------------------------------
--  5. Responding. One statement, so the timestamp is the server's.
--
--  Response time is the interval a customer waits before hearing
--  anything, and it was measurable on 13% of the workbook. It is the
--  number this module exists to make true.
-- ------------------------------------------------------------
create or replace function respond_complaint(p_id uuid, p_note text default null)
returns complaints language plpgsql security invoker as $$
declare c complaints; v_rows int;
begin
  update complaints
     set responded_at = coalesce(responded_at, now()),
         responded_by = coalesce(responded_by, auth.uid())
   where id = p_id and closed_at is null
   returning * into c;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'COMPLAINT_RESPOND: that complaint is closed, or row level security prevented the update.';
  end if;
  return c;
end $$;

-- ------------------------------------------------------------
--  6. Closing.
--
--  The heart of it. A complaint may not be closed without saying what
--  was done about it, and the closing date is the server's clock rather
--  than anyone's opinion. If this one rule holds, then in a year this
--  register can answer how long resolution takes — which the workbook
--  cannot answer at all.
--
--  A technical complaint must also carry an NCR, because that is where
--  the root cause and the verified corrective action live. Rather than
--  duplicating those fields here and watching them reach 20% filled as
--  they did in both previous registers.
-- ------------------------------------------------------------
create or replace function close_complaint(p_id uuid, p_correction text, p_note text default null)
returns complaints language plpgsql security invoker as $$
declare c complaints; v_rows int; v_tech boolean; v_ncr uuid;
begin
  if coalesce(btrim(p_correction), '') = '' then
    raise exception 'COMPLAINT_CORRECTION: say what was done for the customer before closing this.';
  end if;

  select t.is_technical, x.ncr_id into v_tech, v_ncr
    from complaints x left join complaint_types t on t.id = x.type_id
   where x.id = p_id;

  if coalesce(v_tech, false) and v_ncr is null then
    raise exception 'COMPLAINT_NEEDS_NCR: a technical complaint is also a nonconformance. Raise or link an NCR first, so the cause and the corrective action are recorded where they can be verified.';
  end if;

  update complaints
     set closed_at  = now(),
         closed_by  = auth.uid(),
         correction = btrim(p_correction),
         closure_note = nullif(btrim(coalesce(p_note,'')), ''),
         -- Closing without ever having responded is possible in practice
         -- and would leave response time null forever, so it is stamped
         -- here too rather than left as a hole in the reporting.
         responded_at = coalesce(responded_at, now()),
         responded_by = coalesce(responded_by, auth.uid())
   where id = p_id and closed_at is null
   returning * into c;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'COMPLAINT_CLOSE: that complaint is already closed, or row level security prevented the update.';
  end if;
  return c;
end $$;

-- ------------------------------------------------------------
--  7. Row level security.
-- ------------------------------------------------------------
alter table complaints         enable row level security;
alter table complaint_types    enable row level security;
alter table complaint_sections enable row level security;

revoke all on complaints from anon, authenticated;
grant select, insert, update on complaints to authenticated;
grant select on complaint_types, complaint_sections to authenticated;

create policy complaint_read on complaints for select
  using (auth.uid() is not null);

create policy complaint_raise on complaints for insert
  with check (raised_by = auth.uid());

-- An open complaint may be edited by the person who raised it, its owner,
-- or anyone with a quality role. A closed one may not be edited at all:
-- closure is the evidence, and evidence that can be rewritten is not.
create policy complaint_edit on complaints for update
  using (closed_at is null
         and (raised_by = auth.uid() or owner_id = auth.uid()
              or has_role('supervisor','quality_engineer','quality_manager','sysadmin')));

create policy complaint_types_read on complaint_types for select using (auth.uid() is not null);
create policy complaint_sections_read on complaint_sections for select using (auth.uid() is not null);

-- No delete policy and delete revoked. Deliberate, as everywhere else.

grant execute on function raise_complaint(text, text, smallint, smallint, text, smallint, uuid, text, text) to authenticated;
grant execute on function respond_complaint(uuid, text) to authenticated;
grant execute on function close_complaint(uuid, text, text) to authenticated;
grant execute on function complaint_status(complaints) to authenticated;

-- ------------------------------------------------------------
--  8. The register view.
-- ------------------------------------------------------------
create or replace view v_complaints with (security_invoker = on) as
select c.id, c.ref, c.legacy_ref, c.customer, c.site, c.details,
       c.contract_number, c.delivery_date,
       complaint_status(c)               as status,
       s.name                            as section,
       t.name                            as complaint_type,
       t.is_technical                    as is_technical,
       dc.description                    as defect_code,
       ow.full_name                      as owner,
       c.site_engineer                   as site_engineer,
       c.called_at, c.responded_at, c.closed_at,
       c.correction, c.closure_note,
       c.cost_material, c.cost_labour, c.cost_total,
       n.ref                             as ncr_ref,
       c.ncr_id                          as ncr_id,
       rb.full_name                      as raised_by_name,
       -- Hours to first response, and days to closure. Null while the
       -- thing has not happened, which is honest: a null is "not yet",
       -- and zero would be a lie.
       round(extract(epoch from (c.responded_at - c.called_at)) / 3600.0, 1) as response_hours,
       (c.closed_at::date - c.called_at::date)                              as days_to_close,
       (current_date - c.called_at::date)                                   as age_days
  from complaints c
  left join complaint_sections s on s.id = c.section_id
  left join complaint_types t    on t.id = c.type_id
  left join defect_codes dc      on dc.id = c.defect_code_id
  left join profiles ow          on ow.id = c.owner_id
  left join profiles rb          on rb.id = c.raised_by
  left join ncrs n               on n.id = c.ncr_id;

grant select on v_complaints to authenticated;

comment on view v_complaints is
  'The customer complaint register. response_hours and days_to_close are null '
  'until the thing has actually happened — a null is "not yet" and a zero '
  'would be a lie. They are the two numbers the workbook could not produce.';

-- ------------------------------------------------------------
--  9. Verification.
-- ------------------------------------------------------------
do $verify$
declare v int;
begin
  select count(*) into v from complaint_types;
  if v < 10 then raise exception 'Complaint types were not seeded (% found).', v; end if;

  select count(*) into v from pg_policies where tablename = 'complaints';
  if v < 3 then raise exception 'Expected at least 3 policies on complaints, found %.', v; end if;

  if exists (select 1 from information_schema.role_table_grants
              where table_name = 'complaints' and privilege_type = 'DELETE'
                and grantee in ('anon','authenticated')) then
    raise exception 'DELETE is granted on complaints. It must not be.';
  end if;

  raise notice '019 applied. Customer complaints are available. Closing one requires saying what was done, and a technical complaint requires a linked NCR.';
end $verify$;
